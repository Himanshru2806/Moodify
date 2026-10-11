from pydantic import BaseModel, EmailStr, Field, field_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class RegistrationRequest(Credentials):
    display_name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-z0-9_]{3,30}$")

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be blank.")
        return normalized

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-z0-9_]{3,30}$")

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be blank.")
        return normalized

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ProfileResponse(BaseModel):
    email: EmailStr
    display_name: str
    username: str


class EmailRequest(BaseModel):
    email: EmailStr


class TokenRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class PasswordResetRequest(TokenRequest):
    password: str = Field(min_length=12, max_length=128)


class AccessResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    email: EmailStr
    display_name: str
    username: str
    role: str = "user"


class MessageResponse(BaseModel):
    message: str
