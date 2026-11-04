extends Node3D
var box: MeshInstance3D
var keys := 0
var frames := 0
var started := Time.get_ticks_msec()
func _ready() -> void:
	var body := StaticBody3D.new(); body.name="body"; add_child(body)
	box=MeshInstance3D.new(); box.name="box"; box.mesh=BoxMesh.new(); body.add_child(box)
	var mat := StandardMaterial3D.new(); mat.albedo_color=Color(0.2,0.6,0.9); box.material_override=mat
	var shape := CollisionShape3D.new(); shape.shape=BoxShape3D.new(); body.add_child(shape)
	var camera := Camera3D.new(); add_child(camera); camera.position=Vector3(0,2,6); camera.look_at(Vector3.ZERO); camera.make_current()
	var light := DirectionalLight3D.new(); add_child(light); light.rotation_degrees=Vector3(-40,-30,0)
	if not OS.has_feature("web"):
		var adapter := RenderingServer.get_video_adapter_name()
		print("GPU_ADAPTER "+adapter+" method="+RenderingServer.get_current_rendering_method())
		if adapter.is_empty() or ["llvmpipe","lavapipe","software","swiftshader","basic render","warp"].any(func(s): return s in adapter.to_lower()):
			push_error("Hardware Godot renderer unavailable: "+adapter); get_tree().quit(1); return
		stress()
func stress() -> void:
	var instances := MultiMeshInstance3D.new(); instances.multimesh=MultiMesh.new(); instances.multimesh.transform_format=MultiMesh.TRANSFORM_3D
	var sphere := SphereMesh.new(); sphere.radial_segments=32; sphere.rings=16; instances.multimesh.mesh=sphere; instances.multimesh.instance_count=12000; add_child(instances)
	for i in range(12000): instances.multimesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ONE*0.07),Vector3((i%100-50)*0.08,(i/100%100-50)*0.08,-float(i%5)*0.1)))
func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed: keys+=1; box.position.x+=0.1
func _process(_delta: float) -> void:
	frames+=1
	if OS.has_feature("web"):
		var bridge := get_node("/root/AlembicRender")
		JavaScriptBridge.eval("window.godotFixture="+JSON.stringify({"x":box.position.x,"y":box.position.y,"keys":keys,"frames":frames,"io":bridge.io,"screen":bridge.screen}))
	elif Time.get_ticks_msec()-started>10000:
		print("GPU_FRAMES "+str(frames)); get_tree().quit()
func alembic_play(script: Variant, _scenario: Variant) -> Variant:
	if script=="load": stress(); return null
	if script!="move": return {"error":"Unknown fixture script"}
	box.position.y=1; return null
func alembic_reset() -> Variant:
	box.position=Vector3.ZERO; return null
func alembic_scenarios() -> Array: return ["move"]
