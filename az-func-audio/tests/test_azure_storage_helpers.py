import os
import sys
import types

# We will monkeypatch azure_storage.blob_service_client and clients to avoid real Azure calls

def test_attempts_roundtrip(monkeypatch):
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

    class FakeBlobClient:
        def __init__(self):
            self._meta = {}
        def get_blob_properties(self):
            return types.SimpleNamespace(metadata=self._meta)
        def set_blob_metadata(self, metadata):
            self._meta = dict(metadata)
        def exists(self):
            return True
    class FakeBSC:
        def get_blob_client(self, container, blob):
            return FakeBlobClient()

    monkeypatch.setattr(azs, 'blob_service_client', FakeBSC())

    # initially 0
    assert azs.get_blob_attempts('x.wav') == 0
    azs.set_blob_attempts('x.wav', 2)
    assert azs.get_blob_attempts('x.wav') == 2

