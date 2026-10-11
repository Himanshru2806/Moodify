import smtplib
from email.message import EmailMessage

from app.core.config import settings


def send_action_email(recipient: str, subject: str, action_url: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from_email
    message["To"] = recipient
    message.set_content(
        f"Use this one-time link to continue with Moodify. It expires soon and can only be used once:\n\n{action_url}\n\n"
        "If you did not request this, you can ignore this message."
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_starttls:
            client.starttls()
        if settings.smtp_username and settings.smtp_password:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)
