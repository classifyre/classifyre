from src.sources.slack.source import SlackSource
from src.sources.wordpress.source import WordPressSource
from src.utils.hashing import hash_id, hash_url, normalize_http_url, unhash_id


def test_hashing_roundtrip():
    original = "https://example.com_#_posts_#_12345"
    source_type = "WORDPRESS"
    hashed = hash_id(source_type, original)
    unhashed = unhash_id(hashed)
    assert f"{source_type}_#_{original}" == unhashed
    assert hashed != original


def test_hashing_url_safe():
    # Test with characters that often cause issues in base64
    original = "https://example.com/path?query=1&other=2_#_space/id"
    source_type = "SLACK"
    hashed = hash_id(source_type, original)
    assert "+" not in hashed
    assert "/" not in hashed
    assert "=" not in hashed
    assert unhash_id(hashed) == f"{source_type}_#_{original}"


def test_wordpress_generate_hash_id():
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://blog.example.com"},
        "masked": {},
    }

    source = WordPressSource(recipe)
    asset_id = "/posts/67890"
    hashed_id = source.generate_hash_id(asset_id)
    assert hashed_id.startswith("url_sha256:")
    assert len(hashed_id) == len("url_sha256:") + 64


def test_slack_generate_hash_id():
    recipe = {
        "type": "SLACK",
        "required": {"workspace": "acme"},
        "masked": {"bot_token": "xoxb-test-token"},
    }

    source = SlackSource(recipe)
    asset_id = "C123456_#_1700000000.000000"
    hashed_id = source.generate_hash_id(asset_id)

    expected_raw = "SLACK_#_acme_#_C123456_#_1700000000.000000"
    assert unhash_id(hashed_id) == expected_raw


def test_normalize_http_url_resolves_relative_paths():
    normalized = normalize_http_url("/images/photo.jpg", base_url="https://blog.example.com")
    assert normalized == "https://blog.example.com/images/photo.jpg"


def test_normalize_http_url_rejects_non_http_schemes():
    assert normalize_http_url("mailto:test@example.com") is None
    assert normalize_http_url("javascript:void(0)") is None


def test_hash_url_uses_normalized_absolute_url():
    hashed = hash_url("images/photo.jpg", base_url="https://blog.example.com")
    assert hashed.startswith("url_sha256:")
    assert len(hashed) == len("url_sha256:") + 64
