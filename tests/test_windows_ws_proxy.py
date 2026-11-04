import socket
import threading
import unittest
from types import SimpleNamespace
from windows_ws_proxy import proxy_websocket

class WindowsWebSocketProxyTests(unittest.TestCase):
    def test_upgrade_and_bidirectional_binary_frames(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1)
        upstream=socket.create_connection(listener.getsockname());peer,_=listener.accept();listener.close()
        client,server=socket.socketpair()
        handler=SimpleNamespace(command='GET',headers={'Upgrade':'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='},connection=server,close_connection=False)
        errors=[]
        def bridge():
            try:proxy_websocket(handler,SimpleNamespace(sock=upstream),'/vms/vm1/call/ws?ticket=valid_1')
            except Exception as exc:errors.append(exc)
        worker=threading.Thread(target=bridge);worker.start()
        request=peer.recv(4096);self.assertIn(b'GET /vms/vm1/call/ws?ticket=valid_1 HTTP/1.1',request)
        self.assertIn(b'Origin: http://127.0.0.1:',request)
        peer.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n\x82\x02ok')
        response=client.recv(4096);self.assertIn(b'101 Switching Protocols',response);self.assertTrue(response.endswith(b'\x82\x02ok'))
        client.sendall(b'\x88\x00');self.assertEqual(peer.recv(2),b'\x88\x00')
        peer.close();worker.join(3);self.assertFalse(worker.is_alive());self.assertEqual(errors,[])
        client.close();server.close();upstream.close()
    def test_invalid_ticket_rejected_before_network_io(self):
        handler=SimpleNamespace(command='GET',headers={'Upgrade':'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='})
        with self.assertRaises(ValueError):proxy_websocket(handler,None,'/vms/v1/call/ws?ticket=a&bad=1')

if __name__=='__main__':unittest.main()
