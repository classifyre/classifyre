# Maintenance handover

CMMS · Friday 2 October 2026, 07:30 UTC
To: Reliability engineering, Maintenance scheduling, Production supervisors

### Machine M001

M001 has two previous bearing repairs but no teardown diagnosis for this episode. Compare trends at matched operating mode before requesting an inspection.

### Machine M002

M002 has run the approved HIGH_SPEED recipe throughout the historian window, so its higher, steady vibration is expected.

### Change request CR-882

The primary temperature sensor on M003 was switched to Fahrenheit on 30 September. The data adapter still writes reported_unit=C. A gateway queue replay happened this morning: received_at is not the measurement time. T_REFERENCE is an independent, calibrated sensor. The freshness limit is 15 minutes. The quality of the telemetry has to be established before anyone makes a machine-health claim.

### Today's maintenance slot

There are four technician hours. Each intervention is indivisible and needs one free bearing kit. Planned costs include the contribution lost during the planned stop. The failure probabilities are deliberately hypothetical planning inputs: this data cannot establish how accurate a prediction model would be, nor what a repair avoided.
