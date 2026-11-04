import json
import unittest
from canvas_migration import draft

class CanvasMigrationTests(unittest.TestCase):
    def setUp(self):
        self.doc={'format':'alembic.canvas','version':1,'title':'Scene','defaultView':'view','views':['view'],
                  'nodes':[{'id':'view','path':'images/pic.png','inputs':[], 'receipt':{'output':'a'*64,'inputs':{},'resources':{'source/code.js':'b'*64}}}]}
    def test_graph_rebased_and_receipt_resources_declared_with_opaque_blocker(self):
        files={'images/pic.png':b'image','source/code.js':b'code'}
        result=draft(json.dumps(self.doc).encode(),'Scene.canvas','Scene.i3d',files.get)
        graph=result['descriptor'];self.assertEqual(graph['nodes'][0]['path'],'../images/pic.png')
        self.assertEqual(graph['nodes'][0]['receipt']['resources'],self.doc['nodes'][0]['receipt']['resources'])
        self.assertIn({'path':'../source/code.js'},graph['dependencies'].values())
        self.assertTrue(any(x['path']=='source/code.js' for x in result['blockers']))
        self.assertEqual(files['images/pic.png'],b'image')
    def test_traversal_and_missing_sources_are_not_silently_accepted(self):
        self.doc['nodes'][0]['path']='../outside.png'
        with self.assertRaises(ValueError): draft(json.dumps(self.doc).encode(),'Scene.canvas','Scene.i3d',lambda _:None)
        self.doc['nodes'][0]['path']='images/missing.png'
        result=draft(json.dumps(self.doc).encode(),'Scene.canvas','Scene.i3d',lambda _:None)
        self.assertTrue(result['blockers'])

if __name__=='__main__': unittest.main()
