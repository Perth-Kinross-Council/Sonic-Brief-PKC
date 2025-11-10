import os
import sys
import types

# Test move_blob_to_deadletter without real Azure calls

def test_move_blob_to_deadletter(monkeypatch, tmp_path):
    # Stub Azure SDK modules required by azure_storage import
    azure = types.ModuleType('azure')
    storage = types.ModuleType('azure.storage')
    blob = types.ModuleType('azure.storage.blob')
    identity = types.ModuleType('azure.identity')

    class _Dummy:
        def __init__(self, *args, **kwargs):
            pass

    # Minimal dummies for imported names
    blob.BlobServiceClient = _Dummy
    blob.generate_blob_sas = lambda *a, **k: 'sas-token'
    class _Perm:
        def __init__(self, **kwargs):
            pass
    blob.BlobSasPermissions = _Perm
    identity.DefaultAzureCredential = _Dummy
    identity.ManagedIdentityCredential = _Dummy

    sys.modules['azure'] = azure
    sys.modules['azure.storage'] = storage
    sys.modules['azure.storage.blob'] = blob
    sys.modules['azure.identity'] = identity

    # Add az-func-audio directory to import path
    here = os.path.dirname(__file__)
    func_dir = os.path.abspath(os.path.join(here, os.pardir))
    if func_dir not in sys.path:
        sys.path.insert(0, func_dir)

    import azure_storage as azs

    # Fake clients to simulate move
    class FakeSrcBlobClient:
        def __init__(self, url):
            self.url = url
            self._deleted = False
            self._meta = {"attempts": "3"}
        def exists(self):
            return True
        def get_blob_properties(self):
            return types.SimpleNamespace(metadata=self._meta)
        def delete_blob(self):
            self._deleted = True

    class FakeDstBlobClient:
        def __init__(self):
            self._copied_from = None
            self._meta = {}
            self.url = "https://account.blob.core.windows.net/dead/x.wav"
        def start_copy_from_url(self, src):
            self._copied_from = src
        def set_blob_metadata(self, metadata):
            self._meta = dict(metadata)

    class FakeContainerClient:
        def __init__(self):
            self.created = False
        def create_container(self):
            # simulate idempotent create
            self.created = True

    class FakeBSC:
        def __init__(self):
            self.src = FakeSrcBlobClient("https://account.blob.core.windows.net/recordingcontainer/x.wav")
            self.dst = FakeDstBlobClient()
            self.container = FakeContainerClient()
        def get_blob_client(self, container, blob):
            # route by container
            if container.endswith("deadletter"):
                return self.dst
            return self.src
        def get_container_client(self, container):
            return self.container

    monkeypatch.setattr(azs, 'blob_service_client', FakeBSC())
    # Ensure env defaults
    monkeypatch.setenv('AZURE_STORAGE_RECORDINGS_CONTAINER', 'recordingcontainer')

    # Execute
    url = azs.move_blob_to_deadletter('x.wav', 'recordingcontainer-deadletter')

    # Validate
    assert url.endswith('/dead/x.wav')
    # metadata preserved
    assert azs.blob_service_client.dst._meta.get('attempts') == '3'
    # copy started from correct source
    assert azs.blob_service_client.dst._copied_from.endswith('/recordingcontainer/x.wav')
    # source deleted
    assert azs.blob_service_client.src._deleted is True
