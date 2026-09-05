"""Backend tests for Multi-Tenant ERP API - auth, companies, users, profile CRUD, tenant isolation."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fall back to reading frontend/.env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

SUPER = {"email": "ja3442000045@gmail.com", "password": "admin123"}
ACME = {"email": "user@acme.com", "password": "user123"}
GLOB = {"email": "user@glob.com", "password": "user123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def super_login():
    return _login(SUPER)

@pytest.fixture(scope="session")
def acme_login():
    return _login(ACME)

@pytest.fixture(scope="session")
def glob_login():
    return _login(GLOB)

def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_super_login(self, super_login):
        assert super_login["user"]["role"] == "super_admin"
        assert isinstance(super_login["token"], str) and len(super_login["token"]) > 10

    def test_regular_login(self, acme_login):
        assert acme_login["user"]["role"] == "user"
        assert acme_login["user"]["company_name"] == "Acme Industries"
        assert acme_login["user"]["company_id"]

    def test_me(self, acme_login):
        r = requests.get(f"{API}/auth/me", headers=h(acme_login["token"]))
        assert r.status_code == 200
        assert r.json()["email"] == "user@acme.com"

    def test_missing_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_invalid_token(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer invalid.jwt.token"})
        assert r.status_code == 401

    def test_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": SUPER["email"], "password": "wrong"})
        assert r.status_code == 401


# ---------- Companies ----------
class TestCompanies:
    def test_super_sees_all(self, super_login):
        r = requests.get(f"{API}/companies", headers=h(super_login["token"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 3
        names = [c["name"] for c in data]
        for n in ["Acme Industries", "Globex Corp", "Initech LLC"]:
            assert n in names

    def test_regular_sees_only_own(self, acme_login):
        r = requests.get(f"{API}/companies", headers=h(acme_login["token"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["name"] == "Acme Industries"

    def test_regular_cannot_create_company(self, acme_login):
        r = requests.post(f"{API}/companies", headers=h(acme_login["token"]),
                          json={"name": "TEST_X", "code": "TSTX"})
        assert r.status_code == 403

    def test_super_can_create_and_delete(self, super_login):
        code = f"TST{uuid.uuid4().hex[:4].upper()}"
        r = requests.post(f"{API}/companies", headers=h(super_login["token"]),
                          json={"name": f"TEST_{code}", "code": code})
        assert r.status_code == 200
        cid = r.json()["id"]
        # delete
        d = requests.delete(f"{API}/companies/{cid}", headers=h(super_login["token"]))
        assert d.status_code == 200


# ---------- Roles (representative profile resource) ----------
class TestRolesTenant:
    def test_super_all_roles(self, super_login):
        r = requests.get(f"{API}/roles", headers=h(super_login["token"]))
        assert r.status_code == 200
        assert len(r.json()) >= 6  # 3 companies x 2

    def test_super_filter_by_acme(self, super_login, acme_login):
        acme_cid = acme_login["user"]["company_id"]
        r = requests.get(f"{API}/roles?company_id={acme_cid}", headers=h(super_login["token"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 2
        for d in data:
            assert d["company_id"] == acme_cid

    def test_regular_only_own_roles(self, acme_login, glob_login):
        acme_cid = acme_login["user"]["company_id"]
        glob_cid = glob_login["user"]["company_id"]
        # try to sneak into glob's data
        r = requests.get(f"{API}/roles?company_id={glob_cid}", headers=h(acme_login["token"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        for d in data:
            assert d["company_id"] == acme_cid  # forcibly scoped to own

    def test_super_create_without_company_400(self, super_login):
        r = requests.post(f"{API}/roles", headers=h(super_login["token"]),
                          json={"name": "TEST_NoCompany"})
        assert r.status_code == 400

    def test_super_create_with_company(self, super_login, acme_login):
        cid = acme_login["user"]["company_id"]
        r = requests.post(f"{API}/roles", headers=h(super_login["token"]),
                          json={"name": f"TEST_Role_{uuid.uuid4().hex[:5]}", "company_id": cid, "description": "x"})
        assert r.status_code == 200
        body = r.json()
        assert body["company_id"] == cid
        # cleanup
        requests.delete(f"{API}/roles/{body['id']}", headers=h(super_login["token"]))

    def test_regular_create_auto_scopes(self, acme_login, glob_login):
        acme_cid = acme_login["user"]["company_id"]
        glob_cid = glob_login["user"]["company_id"]
        # send glob_cid but should be forced to acme_cid
        r = requests.post(f"{API}/roles", headers=h(acme_login["token"]),
                          json={"name": f"TEST_ARole_{uuid.uuid4().hex[:5]}",
                                "company_id": glob_cid, "description": "x"})
        assert r.status_code == 200
        body = r.json()
        assert body["company_id"] == acme_cid
        # cleanup as owner
        d = requests.delete(f"{API}/roles/{body['id']}", headers=h(acme_login["token"]))
        assert d.status_code == 200

    def test_regular_update_other_company_forbidden(self, acme_login, glob_login):
        # get a glob role
        glob_cid = glob_login["user"]["company_id"]
        r = requests.get(f"{API}/roles?company_id={glob_cid}", headers=h(glob_login["token"]))
        role = r.json()[0]
        # acme user tries to update it
        u = requests.put(f"{API}/roles/{role['id']}", headers=h(acme_login["token"]),
                         json={"name": "HACKED"})
        assert u.status_code == 403

    def test_regular_delete_own(self, acme_login):
        # create then delete
        c = requests.post(f"{API}/roles", headers=h(acme_login["token"]),
                          json={"name": f"TEST_DelRole_{uuid.uuid4().hex[:5]}"})
        assert c.status_code == 200
        rid = c.json()["id"]
        d = requests.delete(f"{API}/roles/{rid}", headers=h(acme_login["token"]))
        assert d.status_code == 200
        # verify gone: attempting delete again -> 404
        d2 = requests.delete(f"{API}/roles/{rid}", headers=h(acme_login["token"]))
        assert d2.status_code == 404


# ---------- All resources CRUD smoke ----------
RESOURCES = ["departments", "routes", "brands", "products", "units", "items", "customers", "employees"]

@pytest.mark.parametrize("res", RESOURCES)
def test_resource_crud(res, acme_login):
    token = acme_login["token"]
    # list
    r = requests.get(f"{API}/{res}", headers=h(token))
    assert r.status_code == 200, f"{res} list failed"
    initial = len(r.json())
    # create
    payload = {"name": f"TEST_{res}_{uuid.uuid4().hex[:5]}"}
    c = requests.post(f"{API}/{res}", headers=h(token), json=payload)
    assert c.status_code == 200, f"{res} create failed: {c.text}"
    rid = c.json()["id"]
    assert c.json()["company_id"] == acme_login["user"]["company_id"]
    # update
    u = requests.put(f"{API}/{res}/{rid}", headers=h(token), json={"name": payload["name"] + "_upd"})
    assert u.status_code == 200
    assert u.json()["name"].endswith("_upd")
    # verify list grew
    r2 = requests.get(f"{API}/{res}", headers=h(token))
    assert len(r2.json()) == initial + 1
    # delete
    d = requests.delete(f"{API}/{res}/{rid}", headers=h(token))
    assert d.status_code == 200


# ---------- Users ----------
class TestUsers:
    def test_super_creates_user_in_any_company(self, super_login, glob_login):
        cid = glob_login["user"]["company_id"]
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users", headers=h(super_login["token"]), json={
            "email": email, "password": "pw123", "name": "TEST U",
            "role": "user", "company_id": cid,
        })
        assert r.status_code == 200
        u = r.json()
        assert u["company_id"] == cid
        # cleanup
        requests.delete(f"{API}/users/{u['id']}", headers=h(super_login["token"]))

    def test_regular_creates_user_scoped(self, acme_login):
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users", headers=h(acme_login["token"]), json={
            "email": email, "password": "pw123", "name": "TEST scoped",
            "role": "user", "company_id": "SOME_OTHER_ID",
        })
        assert r.status_code == 200
        assert r.json()["company_id"] == acme_login["user"]["company_id"]
        requests.delete(f"{API}/users/{r.json()['id']}", headers=h(acme_login["token"]))

    def test_regular_cannot_assign_super_admin(self, acme_login):
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users", headers=h(acme_login["token"]), json={
            "email": email, "password": "pw123", "name": "TEST",
            "role": "super_admin",
        })
        assert r.status_code == 403

    def test_cannot_delete_self(self, super_login):
        r = requests.delete(f"{API}/users/{super_login['user']['id']}", headers=h(super_login["token"]))
        assert r.status_code == 400


# ---------- Dashboard ----------
def test_dashboard_super(super_login):
    r = requests.get(f"{API}/dashboard/summary", headers=h(super_login["token"]))
    assert r.status_code == 200
    data = r.json()
    for key in ["roles", "departments", "companies", "users"]:
        assert key in data
    assert data["companies"] >= 3

def test_dashboard_regular_scoped(acme_login):
    r = requests.get(f"{API}/dashboard/summary", headers=h(acme_login["token"]))
    assert r.status_code == 200
    data = r.json()
    assert data["companies"] == 1
    assert data["roles"] == 2
