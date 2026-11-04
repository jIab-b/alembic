extends Node
# Autoload; no scene/controller replacement. Playback/reset belong to authored scene hooks.
var camera: Camera3D
var center := Vector3.ZERO
var volumes: Node3D
var inbox: Array = []
var callback: JavaScriptObject
var previous := ""
var tool := ""
var saved: Transform3D
var saved_center := Vector3.ZERO
var playing := false
var elapsed := 0.0
var io := false
var held: Dictionary = {}
var keys: Dictionary = {}
var press := Vector2.ZERO

func _ready() -> void:
    if not OS.has_feature("web"):
        return
    callback = JavaScriptBridge.create_callback(func(args): inbox.append(JSON.parse_string(args[0])))
    JavaScriptBridge.get_interface("window").alembicGodotReceive = callback
    JavaScriptBridge.eval("window.alembicGodotBoot()")
    await get_tree().process_frame
    camera = Camera3D.new()
    camera.name = "AlembicInspector"
    add_child(camera)
    var bounds := AABB(Vector3(-1,-1,-1), Vector3(2,2,2))
    for mesh in meshes():
        bounds = bounds.merge(mesh.global_transform * mesh.get_aabb())
    center = bounds.get_center()
    camera.position = center + Vector3(0,0.8,1) * maxf(3,bounds.size.length())
    camera.look_at(center)
    camera.make_current()
    volumes = Node3D.new()
    add_child(volumes)
    for node in get_tree().current_scene.find_children("*","Control",true,false):
        node.visibility_layer=0
    var scene := get_tree().current_scene
    send({"type":"alembic.web.ready","renders":["game"],"scenarios":scene.alembic_scenarios() if scene.has_method(
        "alembic_scenarios") else [],"exports":[],"controls":["orbit","pan","zoom","play","reset","escape"],
        "renderer":{"camera":state()}})

func send(data: Dictionary) -> void:
    JavaScriptBridge.get_interface("window").alembicGodotSend(JSON.stringify(data))

func vec(v: Vector3) -> Array:
    return [v.x,v.y,v.z]
func v3(a: Array) -> Vector3:
    return Vector3(a[0],a[1],a[2])
func columns(p: Projection) -> Array:
    return [p.x.x,p.x.y,p.x.z,p.x.w,p.y.x,p.y.y,p.y.z,p.y.w,p.z.x,p.z.y,p.z.z,p.z.w,p.w.x,p.w.y,p.w.z,p.w.w]
func state() -> Dictionary:
    var active := get_viewport().get_camera_3d()
    var size := get_viewport().get_visible_rect().size
    var view := Projection(active.global_transform.affine_inverse())
    var projection := active.get_camera_projection()
    return {"world":columns(Projection(active.global_transform)),"view":columns(view),"clip":columns(projection*view),
        "width":size.x,"height":size.y,"region":[0,0,size.x,size.y],"distance":camera.position.distance_to(center),
        "windowY":projection.y.y,"orthographic":active.projection==Camera3D.PROJECTION_ORTHOGONAL}
func meshes() -> Array:
    var scene := get_tree().current_scene
    return ([scene] if scene is MeshInstance3D else []) + scene.find_children("*","MeshInstance3D",true,false)
func identity(node: Node) -> Dictionary:
    return {"node":node.get_instance_id(),"id":str(get_tree().current_scene.get_path_to(node)),"name":str(node.name)}
func error(message: String) -> Dictionary:
    return {"error":message}

func query(d: Dictionary) -> Variant:
    var active := get_viewport().get_camera_3d()
    match d.get("operation", ""):
        "viewport": return null # Browser canvas resize drives the actual Godot viewport.
        "camera":
            if not d.has("pose"):
                return error("Camera requires position and target")
            camera.position=v3(d.pose.position)
            center=v3(d.pose.target)
            camera.look_at(center)
            return null
        "io":
            io=d.on
            volumes.visible=not io
            return null
        "release":
            var events := held.values()
            held.clear()
            keys.clear()
            for event in events:
                event.pressed=false
                Input.parse_input_event(event)
            return null
        "pick":
            var pt := Vector2(d.point[0],d.point[1])
            var origin := active.project_ray_origin(pt)
            var direction := active.project_ray_normal(pt)
            var ray := PhysicsRayQueryParameters3D.create(origin,origin+direction*active.far)
            var hit := active.get_world_3d().direct_space_state.intersect_ray(ray)
            var owner: Variant = null
            if not hit.is_empty():
                var node: Node = hit.collider
                var children := node.find_children("*","MeshInstance3D",true,false)
                owner=identity(children[0] if children.size()==1 else node)
            var point: Vector3 = hit.get("position",origin+direction*camera.position.distance_to(center))
            return {"point":vec(point),"object":owner,"camera":state()}
        "objects":
            var s: Dictionary = d.selection
            var found: Array = []
            for mesh in meshes():
                if not mesh.is_visible_in_tree():
                    continue
                var box: AABB = mesh.global_transform*mesh.get_aabb()
                var intersects := false
                if s.has("area"):
                    var low := Vector2(INF,INF)
                    var high := Vector2(-INF,-INF)
                    for i in range(8):
                        var p := box.get_endpoint(i)
                        if active.is_position_behind(p):
                            continue
                        var q := active.unproject_position(p)/get_viewport().get_visible_rect().size
                        low=low.min(q)
                        high=high.max(q)
                    var a: Array = s.area
                    intersects=high.x>=a[0] and low.x<=a[0]+a[2] and high.y>=a[1] and low.y<=a[1]+a[3]
                else:
                    var c := v3(s.center)
                    var h := v3(s.size)*0.5 if s.shape=="box" else v3(s.get("radii",[s.get("radius",1),s.get("radius",
                        1),s.get("radius",1)]))
                    intersects=box.intersects(AABB(c-h,h*2)) if s.shape=="box" else ((c-c.clamp(box.position,
                        box.end))/h.max(Vector3.ONE*0.00001)).length_squared()<=1
                if intersects:
                    found.append(identity(mesh))
            return {"objects":found,"camera":state(),"context":{"camera":state()}}
        "inspect":
            if io or active!=camera:
                return null
            var point := Vector2(d.x,d.y)
            if d.event=="pointerdown":
                press=point
            if d.event=="keydown":
                keys[d.code]=true
            if d.event=="keyup":
                keys.erase(d.code)
            if d.event=="pointerup" and d.button==2 and point.distance_to(press)<=3:
                send({"type":"alembic.web.menu","point":[d.x,d.y]})
            if d.event=="dblclick" and tool=="":
                center=v3(query({"operation":"pick","point":[d.x,d.y]}).point)
                camera.look_at(center)
            if d.event=="pointerup" and d.button==0 and point.distance_to(press)<=6:
                if tool!="":
                    send({"type":"alembic.web.place","shape":tool,"point":query({"operation":"pick","point":[d.x,
                        d.y]}).point,"camera":state()})
                else:
                    send({"type":"alembic.dismiss"})
            if d.event=="wheel":
                camera.position=center+(camera.position-center).normalized()*maxf(camera.near*4,
                    camera.position.distance_to(center)*exp(clampf(d.delta,-80,80)*0.001))
            if d.event=="pointermove" and d.buttons!=0:
                if d.shift or int(d.buttons)&6:
                    var shift := camera.basis*Vector3(-d.dx,d.dy,0)*2*camera.position.distance_to(center)*tan(
                        deg_to_rad(camera.fov)*0.5)/get_viewport().get_visible_rect().size.y
                    camera.position+=shift
                    center+=shift
                elif int(d.buttons)&1:
                    var offset := camera.position-center
                    var turn := 2.0/maxf(512,get_viewport().get_visible_rect().size[get_viewport().get_visible_rect(
                        ).size.max_axis_index()])
                    var yaw: float = atan2(offset.x,offset.z)-d.dx*turn
                    var pitch := clampf(asin(offset.y/offset.length())+d.dy*turn,-1.55,1.55)
                    camera.position=center+Vector3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch))*offset.length()
                camera.look_at(center)
            return null
    return error("Unsupported Godot render operation: "+str(d.get("operation")))

func receive(d: Dictionary) -> void:
    var result: Variant
    match d.get("type", ""):
        "alembic.web.draw":
            for node in volumes.get_children():
                volumes.remove_child(node)
                node.queue_free()
            tool=d.get("tool", "")
            for shape in d.shapes:
                if shape.get("mode", "")=="real":
                    send({"type":"alembic.web.failure","error":"Godot solid geometry editing is unavailable"})
                    continue
                if not shape.has("center"):
                    send({"type":"alembic.web.failure","error":"Godot volumes require a world-space center"})
                    continue
                var mesh := MeshInstance3D.new()
                mesh.mesh=BoxMesh.new() if shape.shape=="box" else SphereMesh.new()
                mesh.scale=v3(shape.size) if shape.shape=="box" else v3(shape.get("radii",[shape.get("radius",1),
                    shape.get("radius",1),shape.get("radius",1)]))*2
                if mesh.mesh is SphereMesh:
                    mesh.mesh.height=1
                    mesh.mesh.radius=0.5
                var material := StandardMaterial3D.new()
                material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
                material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
                material.albedo_color=Color(d.style.color)
                material.albedo_color.a=d.style.alpha
                material.cull_mode=BaseMaterial3D.CULL_DISABLED
                material.depth_draw_mode=BaseMaterial3D.DEPTH_DRAW_DISABLED
                mesh.material_override=material
                volumes.add_child(mesh)
                mesh.position=v3(shape.center)
            return
        "alembic.web.play", "alembic.web.reset":
            var scene := get_tree().current_scene
            var method := "alembic_play" if d.type=="alembic.web.play" else "alembic_reset"
            if not scene.has_method(method):
                result=error("Scene must implement "+method)
            elif method=="alembic_play":
                if not playing:
                    saved=camera.transform
                    saved_center=center
                result=await scene.call(method,d.get("script"),d.get("scenario"))
                if not (result is Dictionary and result.has("error")):
                    playing=true
                    elapsed=0
            else:
                result=await scene.call(method)
                if playing:
                    camera.transform=saved
                    center=saved_center
                playing=false
        _:
            if d.get("operation")=="capture":
                volumes.visible=false
                await RenderingServer.frame_post_draw
                var image := get_viewport().get_texture().get_image()
                var a: Array = d.get("area",[0,0,1,1])
                image=image.get_region(Rect2i(int(a[0]*image.get_width()),int(a[1]*image.get_height()),maxi(1,int(
                    a[2]*image.get_width())),maxi(1,int(a[3]*image.get_height()))))
                var scale := minf(1,512.0/maxi(image.get_width(),image.get_height()))
                image.resize(maxi(1,int(image.get_width()*scale)),maxi(1,int(image.get_height()*scale)))
                volumes.visible=not io
                send({"type":"alembic.web.result","id":d.id,"ok":true,"png":Marshalls.raw_to_base64(
                    image.save_png_to_buffer())})
                return
            result=query(d)
    if result is Dictionary and result.has("error"):
        send({"type":"alembic.web.result","id":d.get("id"),"ok":false,"error":result.error})
    elif d.has("id"):
        send({"type":"alembic.web.result","id":d.id,"ok":true,"result":result})

func _physics_process(delta: float) -> void:
    if not camera:
        return
    while not inbox.is_empty():
        receive(inbox.pop_front())
    if not io:
        var step := camera.basis*Vector3(float(keys.has("KeyD"))-float(keys.has("KeyA")),0,float(keys.has(
            "KeyS"))-float(keys.has("KeyW")))
        if keys.has("Space"):
            step.y+=1
        var shift := step.normalized()*maxf(0.01,camera.position.distance_to(center))*0.4*delta
        camera.position+=shift
        center+=shift
    var snapshot := state()
    var key := JSON.stringify(snapshot)
    if key!=previous:
        previous=key
        send({"type":"alembic.web.camera","camera":snapshot,"at":Time.get_unix_time_from_system()*1000})
    if playing:
        elapsed+=delta
        send({"type":"alembic.web.time","time":elapsed})

func _input(event: InputEvent) -> void:
    if event is InputEventKey or event is InputEventMouseButton:
        var key := str(event.physical_keycode) if event is InputEventKey else "mouse"+str(event.button_index)
        if event.pressed:
            held[key]=event.duplicate()
        else:
            held.erase(key)
