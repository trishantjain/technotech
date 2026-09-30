# Snapshot Worker Documentation

## Purpose
The snapshot worker is responsible for receiving snapshot requests from RabbitMQ, capturing a camera image, validating the image, and publishing the success result for downstream processing.

This worker handles three camera paths:
- Techno camera (`cameraType = T`) via external executable (`ReadImage.exe`)
- Sparsh camera (`cameraType = S`) via HTTP snapshot endpoint
- HiFocus (all other types) via `ffmpeg` RTSP frame capture

Current implementation file:
- `server/workers/snapshotWorker.js`

## High-Level Architecture
1. Worker connects to RabbitMQ using `RABBIT_URL`.
2. Worker consumes messages from `snapshot.queue`.
3. For each message:
   - Validate payload
   - Build output image path (`SNAP_DIR/<macSuffix>/image_<timestamp>.jpg`)
   - Capture image based on camera type
   - Validate image using `sharp`
   - Publish success to `snapshot.done`
4. On failure, worker currently requeues message with `channel.nack(msg, false, true)`.

## Environment Variables
Required:
- `RABBIT_URL`: RabbitMQ connection URL
- `SNAP_DIR`: Base directory where snapshot files are stored

Optional:
- `READIMAGE_EXE_PATH`: Explicit path to ReadImage executable (overrides default discovery)
- `READIMAGE_TIMEOUT_MS`: Timeout for one Techno capture attempt (default: 20000 ms)
- `READIMAGE_ARGS_JSON`: JSON array for custom ReadImage arguments with placeholders `{ip}` and `{out}`
- `SPARSH_SNAPSHOT_DELAY_MS`: Parsed but not currently applied in active flow

## Queue Contract
### Input Queue: `snapshot.queue`
Expected message body (JSON):
- `mac` (string): Device MAC/identifier
- `cameraType` (string): Camera type (`T`, `S`, or other)
- `cameraIP` (string): Camera IP address

Validation behavior:
- If JSON parse fails: message is acknowledged and dropped
- If required fields missing: message is acknowledged and dropped

### Output Queue: `snapshot.done`
Published on successful capture:
- `mac`
- `filename`
- `createdAt`
- `source` (fixed as `camera`)

## Detailed Execution Flow
### 1) Worker startup
At process startup (`startWorker()`):
- Loads `.env`
- Verifies `RABBIT_URL` and `SNAP_DIR`
- Connects to RabbitMQ
- Asserts queues `snapshot.queue` and `snapshot.done`
- Sets `prefetch(50)`

### 2) Message consumption
For each message from `snapshot.queue`:
1. Parse JSON payload
2. Validate required fields (`mac`, `cameraType`, `cameraIP`)
3. Generate timestamped filename
4. Build output folder using MAC suffix (last part of MAC, with separators normalized)
5. Ensure output directory exists

### 3) Camera-specific capture
#### A) Techno camera (`cameraType = T`)
Function chain:
- `captureTechno()`
  - `getReadImageConfig()`
  - `runReadImageOnce()` (inside retry loop)

Behavior:
- Chooses executable from:
  - `READIMAGE_EXE_PATH` if set
  - otherwise defaults to `ReadImage.exe` (current active code)
- Runs up to 3 attempts by default
- Each attempt:
  1. Spawn ReadImage process
  2. Enforce timeout (default 20 seconds)
  3. On timeout, terminate process tree (`taskkill /T /F` on Windows)
  4. Ensure output file exists and size > 0
  5. Validate JPEG integrity using `sharp`
- On attempt failure:
  - Logs error
  - Deletes partial/invalid output file if present
  - Waits with linear backoff (`2s`, `4s`) before next attempt
- After all attempts fail:
  - Throws error to consumer

#### B) Sparsh camera (`cameraType = S`)
- Uses Axios `GET`
- Writes stream directly to output file
- Timeout is 10 seconds

Note: URL in current code points to `https://picsum.photos/800/600` (dummy/test source), not camera CGI endpoint.

#### C) HiFocus camera (fallback)
- Uses `ffmpeg` to capture single frame from configured input

Note: Current code uses dummy URL `https://picsum.photos/800/600` in the `ffmpeg` command for testing.

### 4) Final validation and success publish
After capture function returns:
- Worker validates output file again via `sharp`
- On success, sends payload to `snapshot.done`
- Acknowledges original message (`ack`)

### 5) Error handling behavior
On any failure in consume block:
- Worker logs stack/error
- Worker currently does `channel.nack(msg, false, true)`

This means message is requeued and can be retried indefinitely at queue level.

## Important Operational Notes
1. Two retry layers may exist depending on design choice:
- Internal retry in `captureTechno()` (currently active)
- Queue-level requeue (`nack(..., true)`) after final failure (currently active)

2. Because queue-level requeue is enabled, one failing device can repeatedly cycle through 3 internal attempts and then be requeued again.

3. For corrupted-frame tests, repeated `Corrupted image detected by sharp` indicates the camera/executable keeps producing invalid bytes for all attempts.

4. A normal direct `ReadImage.exe` run can still succeed while queued attempts fail, if upstream camera/STM state differs between manual and queued trigger timing.

## Observability and Logs
Current logs include:
- Worker startup
- Device request fields (`mac`, `cameraIP`, `cameraType`)
- Per-attempt capture start and failure reason
- Backoff wait duration
- Success publish activity

Useful failure signatures:
- `ReadImage timed out after ...`
- `ReadImage exited with code ...`
- `ReadImage output file is empty or invalid ...`
- `Corrupted image detected by sharp`

## Current Limitations
1. Queue requeue strategy can cause unbounded retries.
2. Sparsh and HiFocus paths are using dummy/test image sources in current code.
3. `SPARSH_SNAPSHOT_DELAY_MS` is currently parsed but not actively used.
4. No per-message retry counter in queue payload for bounded dead-letter behavior.

## Recommended Production Improvements
1. Add bounded queue retry policy:
- Include `retryCount` in message and dead-letter after max retries
- Or configure DLQ with `x-dead-letter-routing-key`

2. Keep only one retry layer to reduce amplification:
- Either internal retries in `captureTechno()`
- Or queue-level retries, not both unlimited

3. Replace dummy capture URLs with real camera endpoints for Sparsh/HiFocus.

4. Add structured logs (attempt number, camera type, execution time, final disposition).

5. Track capture metrics:
- Success/failure rate per camera
- Failure reason distribution
- Retry depth and latency

## Quick Reference
Main functions in `snapshotWorker.js`:
- `startWorker()`
- `captureTechno()`
- `runReadImageOnce()`
- `getReadImageConfig()`
- `captureSparsh()`
- `captureHiFocus()`
- `validateImage()`
- `terminateProcessTree()`

## Summary for Stakeholders
The snapshot worker is a queue-driven image acquisition service with per-camera capture strategies, file validation, and asynchronous completion signaling through RabbitMQ. It includes robust process timeout handling for Techno cameras and image integrity validation using `sharp`. Current behavior prioritizes reliability through retries, but queue-level requeue should be bounded for predictable failure handling in production.