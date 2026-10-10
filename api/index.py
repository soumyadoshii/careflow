from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Careflow Clinic ERP Backend")

# Enable CORS for the local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    username: str
    password: str

@app.get("/")
def health_check():
    return {"status": "ok", "service": "Careflow API"}

@app.post("/auth/login")
@app.post("/api/auth/login")
def login(creds: LoginRequest):
    # Returns authenticated profile matching frontend schema
    return {
        "access_token": "demo_jwt_token_12345",
        "token_type": "bearer",
        "user": {
            "id": "usr_demo",
            "username": creds.username,
            "name": creds.username.capitalize(),
            "role": "admin" if "admin" in creds.username.lower() else "doctor",
            "email": f"{creds.username}@careflow.clinic",
        }
    }
