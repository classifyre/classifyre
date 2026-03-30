#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# API base URL
API_URL="http://localhost:8000"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_test() {
    echo -e "${YELLOW}TEST: $1${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    ((TESTS_FAILED++))
}

cleanup() {
    if [ -n "$SOURCE_ID" ]; then
        echo -e "\n${YELLOW}Note: Test source $SOURCE_ID was created but not deleted (no DELETE endpoint)${NC}"
        echo -e "${YELLOW}You may want to manually clean up test data from the database.${NC}"
    fi
}

trap cleanup EXIT

echo "========================================"
echo "Source Detector Integration Tests"
echo "========================================"
echo "API URL: $API_URL"
echo ""

# Test 1: Get available detectors
log_test "1. Get all available detector types"
RESPONSE=$(curl -s "$API_URL/detectors")
if echo "$RESPONSE" | jq -e 'length == 6' > /dev/null; then
    log_success "Got 6 detector types"
else
    log_error "Expected 6 detector types"
    echo "Response: $RESPONSE"
fi

if echo "$RESPONSE" | jq -e '[.[].type] | contains(["SECRETS", "PII", "TOXIC", "NSFW", "YARA", "BROKEN_LINKS"])' > /dev/null; then
    log_success "All detector types present (SECRETS, PII, TOXIC, NSFW, YARA, BROKEN_LINKS)"
else
    log_error "Missing detector types"
fi

# Verify SECRETS detector structure
if echo "$RESPONSE" | jq -e '.[] | select(.type == "SECRETS") | has("displayName", "description", "category", "configSchema", "supportedContentTypes")' > /dev/null; then
    log_success "SECRETS detector has correct structure"
else
    log_error "SECRETS detector missing required fields"
fi

echo ""

# Test 2: Create a source
log_test "2. Create a new source"
CREATE_RESPONSE=$(curl -s -X POST "$API_URL/sources" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "WORDPRESS",
        "name": "Integration Test Source",
        "config": {
            "type": "WORDPRESS",
            "required": {
                "url": "https://blog.example.com"
            },
            "masked": {
                "username": "admin",
                "application_password": "test-application-password"
            }
        }
    }')

SOURCE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id')
if [ -n "$SOURCE_ID" ] && [ "$SOURCE_ID" != "null" ]; then
    log_success "Source created with ID: $SOURCE_ID"
else
    log_error "Failed to create source"
    echo "Response: $CREATE_RESPONSE"
    exit 1
fi

echo ""

# Test 3: Get source detectors (should be empty initially)
log_test "3. Get detectors for new source (should be empty)"
DETECTORS=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
if echo "$DETECTORS" | jq -e 'length == 0' > /dev/null; then
    log_success "Source has no detectors initially"
else
    log_error "Expected empty detector list"
fi

echo ""

# Test 4: Add SECRETS detector
log_test "4. Add SECRETS detector to source"
ADD_SECRETS=$(curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "SECRETS",
        "enabled": true,
        "config": {
            "enabled_patterns": ["aws", "github", "slack"],
            "confidence_threshold": 0.7,
            "max_findings": 100
        }
    }')

DETECTOR_ID=$(echo "$ADD_SECRETS" | jq -r '.id')
if [ -n "$DETECTOR_ID" ] && [ "$DETECTOR_ID" != "null" ]; then
    log_success "SECRETS detector added with ID: $DETECTOR_ID"
else
    log_error "Failed to add SECRETS detector"
    echo "Response: $ADD_SECRETS"
fi

# Verify detector type and config
if echo "$ADD_SECRETS" | jq -e '.detectorType == "SECRETS" and .enabled == true' > /dev/null; then
    log_success "SECRETS detector has correct type and enabled state"
else
    log_error "SECRETS detector type or enabled state incorrect"
fi

if echo "$ADD_SECRETS" | jq -e '.config.enabled_patterns | contains(["aws", "github", "slack"])' > /dev/null; then
    log_success "SECRETS detector config saved correctly"
else
    log_error "SECRETS detector config incorrect"
fi

echo ""

# Test 5: Add PII detector
log_test "5. Add PII detector to source"
ADD_PII=$(curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "PII",
        "enabled": true,
        "config": {
            "enabled_patterns": ["ssn", "credit_card", "email"],
            "confidence_threshold": 0.8,
            "max_findings": 50
        }
    }')

if echo "$ADD_PII" | jq -e '.detectorType == "PII"' > /dev/null; then
    log_success "PII detector added successfully"
else
    log_error "Failed to add PII detector"
fi

echo ""

# Test 6: Get all detectors for source
log_test "6. Get all detectors for source (should have 2)"
ALL_DETECTORS=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
if echo "$ALL_DETECTORS" | jq -e 'length == 2' > /dev/null; then
    log_success "Source has 2 detectors"
else
    log_error "Expected 2 detectors"
    echo "Response: $ALL_DETECTORS"
fi

if echo "$ALL_DETECTORS" | jq -e '[.[].detectorType] | contains(["SECRETS", "PII"])' > /dev/null; then
    log_success "Both SECRETS and PII detectors present"
else
    log_error "Missing expected detector types"
fi

echo ""

# Test 7: Update SECRETS detector
log_test "7. Update SECRETS detector configuration"
UPDATE_SECRETS=$(curl -s -X PUT "$API_URL/sources/$SOURCE_ID/detectors/SECRETS" \
    -H "Content-Type: application/json" \
    -d '{
        "enabled": false,
        "config": {
            "enabled_patterns": ["aws", "github"],
            "confidence_threshold": 0.85,
            "max_findings": 200
        }
    }')

if echo "$UPDATE_SECRETS" | jq -e '.enabled == false and .config.confidence_threshold == 0.85' > /dev/null; then
    log_success "SECRETS detector updated (disabled, threshold 0.85)"
else
    log_error "SECRETS detector update failed"
    echo "Response: $UPDATE_SECRETS"
fi

if echo "$UPDATE_SECRETS" | jq -e '.config.max_findings == 200' > /dev/null; then
    log_success "SECRETS detector max_findings updated to 200"
else
    log_error "SECRETS detector max_findings not updated"
fi

echo ""

# Test 8: Partial update (only enabled flag)
log_test "8. Partially update SECRETS detector (re-enable only)"
PARTIAL_UPDATE=$(curl -s -X PUT "$API_URL/sources/$SOURCE_ID/detectors/SECRETS" \
    -H "Content-Type: application/json" \
    -d '{
        "enabled": true
    }')

if echo "$PARTIAL_UPDATE" | jq -e '.enabled == true and .config.confidence_threshold == 0.85' > /dev/null; then
    log_success "SECRETS detector re-enabled, config preserved"
else
    log_error "Partial update failed"
fi

echo ""

# Test 9: Upsert detector (add same type again)
log_test "9. Upsert SECRETS detector (POST again with new config)"
UPSERT_SECRETS=$(curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "SECRETS",
        "enabled": true,
        "config": {
            "enabled_patterns": ["aws", "github", "slack", "stripe"],
            "confidence_threshold": 0.9,
            "max_findings": 300
        }
    }')

if echo "$UPSERT_SECRETS" | jq -e '.config.confidence_threshold == 0.9 and (.config.enabled_patterns | length == 4)' > /dev/null; then
    log_success "SECRETS detector upserted (threshold 0.9, 4 patterns)"
else
    log_error "Upsert failed"
fi

# Verify still only 2 detectors (upsert, not create)
ALL_DETECTORS_AFTER_UPSERT=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
if echo "$ALL_DETECTORS_AFTER_UPSERT" | jq -e 'length == 2' > /dev/null; then
    log_success "Still only 2 detectors (upsert worked correctly)"
else
    log_error "Expected 2 detectors after upsert"
fi

echo ""

# Test 10: Add TOXIC and NSFW detectors
log_test "10. Add TOXIC and NSFW detectors"
curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "TOXIC",
        "enabled": true,
        "config": {
            "enabled_patterns": ["toxic", "threat"],
            "confidence_threshold": 0.75
        }
    }' > /dev/null

curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "NSFW",
        "enabled": true,
        "config": {
            "confidence_threshold": 0.8
        }
    }' > /dev/null

ALL_DETECTORS_WITH_4=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
if echo "$ALL_DETECTORS_WITH_4" | jq -e 'length == 4' > /dev/null; then
    log_success "Source now has 4 detectors"
else
    log_error "Expected 4 detectors"
fi

echo ""

# Test 11: Delete PII detector
log_test "11. Delete PII detector from source"
DELETE_RESPONSE=$(curl -s -w "%{http_code}" -X DELETE "$API_URL/sources/$SOURCE_ID/detectors/PII")
if [ "$DELETE_RESPONSE" = "204" ]; then
    log_success "PII detector deleted (HTTP 204)"
else
    log_error "Expected HTTP 204, got: $DELETE_RESPONSE"
fi

ALL_DETECTORS_AFTER_DELETE=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
if echo "$ALL_DETECTORS_AFTER_DELETE" | jq -e 'length == 3' > /dev/null; then
    log_success "Source now has 3 detectors (PII removed)"
else
    log_error "Expected 3 detectors after deletion"
fi

if echo "$ALL_DETECTORS_AFTER_DELETE" | jq -e '[.[].detectorType] | contains(["PII"]) | not' > /dev/null; then
    log_success "PII detector not in list"
else
    log_error "PII detector still present"
fi

echo ""

# Test 12: Error handling - non-existent source
log_test "12. Error handling - Get detectors for non-existent source"
FAKE_SOURCE_ID="00000000-0000-0000-0000-000000000000"
ERROR_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/sources/$FAKE_SOURCE_ID/detectors")
HTTP_CODE=$(echo "$ERROR_RESPONSE" | tail -1)
if [ "$HTTP_CODE" = "404" ]; then
    log_success "Got 404 for non-existent source"
else
    log_error "Expected 404, got: $HTTP_CODE"
fi

echo ""

# Test 13: Error handling - Update non-existent detector
log_test "13. Error handling - Update detector that doesn't exist"
UPDATE_ERROR=$(curl -s -w "\n%{http_code}" -X PUT "$API_URL/sources/$SOURCE_ID/detectors/YARA" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}')
HTTP_CODE=$(echo "$UPDATE_ERROR" | tail -1)
if [ "$HTTP_CODE" = "404" ]; then
    log_success "Got 404 when updating non-existent detector"
else
    log_error "Expected 404, got: $HTTP_CODE"
fi

echo ""

# Test 14: Error handling - Delete non-existent detector
log_test "14. Error handling - Delete detector that doesn't exist"
DELETE_ERROR=$(curl -s -w "%{http_code}" -X DELETE "$API_URL/sources/$SOURCE_ID/detectors/PII")
if [ "$DELETE_ERROR" = "404" ]; then
    log_success "Got 404 when deleting non-existent detector"
else
    log_error "Expected 404, got: $DELETE_ERROR"
fi

echo ""

# Test 15: Add detector with minimal config
log_test "15. Add YARA detector with minimal config (no config object)"
ADD_YARA=$(curl -s -X POST "$API_URL/sources/$SOURCE_ID/detectors" \
    -H "Content-Type: application/json" \
    -d '{
        "detectorType": "YARA"
    }')

if echo "$ADD_YARA" | jq -e '.detectorType == "YARA" and .enabled == true' > /dev/null; then
    log_success "YARA detector added with defaults (enabled=true)"
else
    log_error "Failed to add YARA with minimal config"
fi

echo ""

# Test 16: Verify cascade delete (SKIPPED - no DELETE endpoint for sources)
log_test "16. Cascade delete test (SKIPPED - API doesn't have DELETE /sources endpoint)"
DETECTORS_FINAL=$(curl -s "$API_URL/sources/$SOURCE_ID/detectors")
DETECTOR_COUNT=$(echo "$DETECTORS_FINAL" | jq 'length')
log_success "Source has $DETECTOR_COUNT detectors at end of test (cleanup manual)"

echo ""
echo "========================================"
echo "Test Results"
echo "========================================"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed ✗${NC}"
    exit 1
fi
