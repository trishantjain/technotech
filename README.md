# TechnoTech - Energy Management System (EMS)

A full-stack IoT-based Energy Management System for real-time monitoring and control of remote electrical/environmental equipment. The platform ingests live sensor data over TCP from field devices, processes alarms, captures IP camera snapshots, and presents everything through a responsive React dashboard.

---

## Table of Contents

- [High-Level Design (HLD)](#high-level-design-hld)
  - [System Overview](#system-overview)
  - [Architecture Diagram](#architecture-diagram)
  - [Component Summary](#component-summary)
  - [Technology Stack](#technology-stack)
  - [Data Flow](#data-flow)
  - [Deployment Architecture](#deployment-architecture)
- [Low-Level Design (LLD)](#low-level-design-lld)
  - [Backend Server](#backend-server)
    - [TCP Server](#tcp-server)
    - [REST API Endpoints](#rest-api-endpoints)
    - [SSE (Server-Sent Events)](#sse-server-sent-events)
  - [Database Models](#database-models)
  - [Message Queue (RabbitMQ)](#message-queue-rabbitmq)
    - [Queues](#queues)
    - [Workers](#workers)
  - [Simulator](#simulator)
  - [Frontend](#frontend)
    - [Pages and Routing](#pages-and-routing)
    - [Key Components](#key-components)
  - [Threshold and Alarm Engine](#threshold-and-alarm-engine)
  - [Cleanup and Maintenance](#cleanup-and-maintenance)

---

## High-Level Design (HLD)

### System Overview

The EMS platform monitors remote telecom/electrical shelters equipped with IoT sensor boards. Each board periodically sends a binary packet (over TCP) containing environmental readings (temperature, humidity, voltage, etc.) and status flags (door, lock, fire alarm, water leakage, fan health). The backend ingests these packets, evaluates threshold-based alarms, persists readings to MongoDB, offloads heavy I/O tasks (alarm logging, snapshot capture, data logging) to RabbitMQ workers, and pushes real-time updates to the React frontend.

### Architecture Diagram

```
+---------------------+          TCP (port 4000)          +-------------------------+
|   IoT Sensor Board  | --------------------------------> |                         |
|  (Field Device /    |                                   |   Node.js Backend       |
|   Simulator)        |                                   |   (server_IP.js)        |
+---------------------+                                   |                         |
                                                          |  - TCP Server           |
                                                          |  - Express HTTP API     |
+---------------------+        HTTP (port 5000)           |  - SSE Push             |
|   React Frontend    | <-------------------------------> |                         |
|   (Dashboard)       |                                   +-------+---------+-------+
+---------------------+                                           |         |
        |                                                         |         |
        | SSE (snapshot events)                                   |         |
        |                                                  publish|    read/|write
        |                                                         v         v
        |                                               +---------+---+ +---+--------+
        |                                               |  RabbitMQ   | |  MongoDB   |
        |                                               |  (AMQP)     | |  (Mongo 6) |
        |                                               +------+------+ +------------+
        |                                                      |
        |                                         consume      |
        |                              +----------+------------+----------+
        |                              |          |                       |
        |                        +-----v----+ +--v----------+  +---------v--------+
        |                        | Alarm    | | Snapshot    |  | Log              |
        |                        | Worker   | | Worker      |  | Worker           |
        |                        +----------+ +-------------+  +------------------+
        |                        writes .inc   captures RTSP    writes .inc/.out
        |                        alarm logs    / HTTP snapshots  sensor & cmd logs
```

### Component Summary

| Component | Role |
|---|---|
| **IoT Sensor Board / Simulator** | Sends 58-byte binary packets over TCP containing sensor readings and status flags |
| **Node.js Backend** | Central server: ingests TCP data, exposes REST + SSE APIs, publishes tasks to RabbitMQ, bulk-saves readings to MongoDB |
| **React Frontend** | Real-time dashboard with gauges, maps, device tiles, alarm indicators, snapshot viewer, and admin panel |
| **MongoDB** | Persistent store for sensor readings, device metadata, and user accounts |
| **RabbitMQ** | Message broker decoupling heavy I/O (alarm file logging, camera snapshots, data logging) from the hot TCP path |
| **Workers (Alarm, Snapshot, Log)** | Independent consumers that handle file-based logging and camera image capture asynchronously |
| **Relay Server** | Optional TCP relay for forwarding device data from a local network to a remote (AWS) server |

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS, Recharts, React-Leaflet, SweetAlert2 |
| Backend | Node.js, Express 5, Mongoose, JSON Web Tokens (JWT), bcrypt |
| Database | MongoDB 6 |
| Message Broker | RabbitMQ 3 (amqplib) |
| Real-Time | Server-Sent Events (SSE), raw TCP sockets |
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions -> EC2 (SSH deploy), Nginx |
| Simulator | Node.js TCP client with WebSocket UI control |

### Data Flow

1. **Device -> Backend (TCP):** Each device opens a persistent TCP connection to port 4000 and sends 58-byte binary packets every ~3 seconds containing an IP-encoded identifier, sensor floats, and status bytes.
2. **Backend Parsing:** The TCP server buffers incoming bytes, extracts complete 58-byte packets, decodes sensor fields (humidity, temperatures, voltages, fan status bits, HUPS alarms, etc.), applies temperature calibration, and evaluates threshold alarms.
3. **Bulk DB Write:** Parsed readings are pushed into an in-memory buffer and flushed to MongoDB via `insertMany` every 2 seconds or when the buffer reaches 1000 documents.
4. **Alarm Processing (RabbitMQ):** When threshold violations or status alarms are detected, the server publishes to `alarm.queue`. The Alarm Worker consumes these messages and appends entries to per-device `.inc` log files.
5. **Snapshot Capture (RabbitMQ):** When the device signals a door-open event (via padding byte `0x43`), the server publishes to `snapshot.queue`. The Snapshot Worker captures a frame via RTSP (HiFocus) or HTTP (Sparsh) and publishes a completion event to `snapshot.done`.
6. **SSE to Frontend:** The backend consumes `snapshot.done` and broadcasts events to connected SSE clients so the dashboard can refresh snapshots in real time.
7. **Frontend Polling:** The React dashboard polls `/api/readings`, `/api/all-devices`, and `/api/devices-info` every 5 seconds to refresh sensor data and device status.
8. **Command Control:** The dashboard sends commands (fan control, lock open/reset) via `POST /command`, which writes directly to the device's TCP socket.

### Deployment Architecture

```
GitHub (master branch)
        |
        v  (push triggers GitHub Actions)
+-------------------+
| GitHub Actions CI |
|  - npm install    |
|  - npm run build  |
|  - SCP build to   |
|    EC2            |
|  - SSH: reload    |
|    nginx          |
|  - SSH: docker-   |
|    compose up     |
+-------------------+
        |
        v
+---------------------------+
|  AWS EC2 Instance         |
|  +---------------------+  |
|  | Nginx (static files)|  |  <- serves React build
|  +---------------------+  |
|  | Docker Compose       |  |
|  |  - ems-api           |  |  <- server_IP.js (ports 4000, 5000)
|  |  - ems-alarm-worker  |  |
|  |  - ems-snapshot-worker|  |
|  |  - ems-log-worker    |  |
|  |  - ems-rabbitmq      |  |  <- ports 5672, 15672
|  |  - ems-mongo         |  |  <- port 27017 (persistent volume)
|  +---------------------+  |
+---------------------------+
```

---

## Low-Level Design (LLD)

### Backend Server

The main server (`server/server_IP.js`) runs two listeners:

- **TCP Server** on port **4000** - raw binary device data ingestion
- **HTTP/Express Server** on port **5000** - REST API + SSE

#### TCP Server

**Packet Format (58 bytes):**

| Offset | Length | Field | Type |
|--------|--------|-------|------|
| 0-7 | 8 | IP Address (hex ASCII) | ASCII string |
| 8-16 | 9 | *(reserved / alignment)* | - |
| 17-20 | 4 | Humidity | Float32LE |
| 21-24 | 4 | Inside Temperature | Float32LE |
| 25-28 | 4 | Outside Temperature | Float32LE |
| 29 | 1 | Lock Status (0=CLOSED, 1=OPEN) | UInt8 |
| 30 | 1 | Door Status (0=CLOSED, 1=OPEN) | UInt8 |
| 31 | 1 | Water Logging | UInt8 (boolean) |
| 32 | 1 | Water Leakage | UInt8 (boolean) |
| 33-34 | 2 | Output Voltage | Int16LE |
| 35-36 | 2 | HUPS DVC Voltage | Int16LE |
| 37-38 | 2 | Input Voltage | Int16LE |
| 39-40 | 2 | HUPS Battery Voltage | Int16LE |
| 41-44 | 4 | Battery Backup | Float32LE |
| 45 | 1 | Alarm Active | UInt8 (boolean) |
| 46 | 1 | Fire Alarm | UInt8 |
| 47-50 | 4 | Fan Group Running (L1-L4) | 4 x UInt8 (boolean) |
| 51 | 1 | Padding / Camera Trigger | UInt8 (0x43 = capture) |
| 52-53 | 2 | Fan Status Bits (6 fans x 2 bits) | UInt16LE |
| 54 | 1 | Password Fail Count | UInt8 |
| 55 | 1 | HUPS Status (8 alarms, bitfield) | UInt8 |
| 56 | 1 | HUPS Reserved | UInt8 |
| 57 | 1 | Fail Mask | UInt8 |

**Parsing Logic:**
1. Buffer incoming TCP data per socket (`socket.buffer`).
2. Handle optional `tcp2` preamble on first connection.
3. Validate 8-byte hex ASCII header as a valid `192.168.x.y` IP.
4. Extract one 58-byte packet at a time; discard malformed headers by advancing 1 byte (resync).
5. Decode all sensor fields using Little-Endian reads.
6. Apply temperature calibration via a lookup table.
7. Extract individual fan status (2 bits each) and HUPS alarms (1 bit each) via bitwise operations.
8. Evaluate threshold alarms and build active alarm list.
9. Push reading to in-memory buffer for bulk DB insert.
10. If `padding == 0x43` and `door == OPEN`, publish snapshot job to RabbitMQ.
11. If alarms are active, publish alarm event to RabbitMQ.
12. Respond with `%X000<datetime>$` when `padding == 0x31` (acknowledgment).

#### REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ping` | Health check (pings MongoDB) |
| `POST` | `/api/login` | Authenticate user (admin via env vars, others via DB + bcrypt) |
| `POST` | `/api/register-user` | Register a new user (admin, block, gp, user roles) |
| `GET` | `/api/users` | List all registered users |
| `PUT` | `/api/user/:id` | Edit user (requires admin password) |
| `DELETE` | `/api/user/:username` | Delete user (requires admin password) |
| `POST` | `/api/register-device` | Register a new IoT device with location and camera info |
| `GET` | `/api/devices-info` | Get all device metadata (including IP camera details) |
| `GET` | `/api/devices` | Get currently connected device IPs |
| `GET` | `/api/all-devices` | Get all registered device IPs |
| `GET` | `/api/device/:mac` | Get latest sensor reading for a device |
| `PUT` | `/api/device/:mac` | Update device metadata (requires admin password) |
| `POST` | `/api/device/delete/:mac` | Delete a device (requires admin password) |
| `GET` | `/api/readings` | Get last 600 sensor readings (all devices) |
| `GET` | `/api/historical-data` | Get readings for a device on a specific date |
| `GET` | `/api/alarm-history` | Get alarm event history for a device (time range) |
| `GET` | `/api/snapshots` | List last 15 snapshot images for a device |
| `GET` | `/api/snapshots/:imageName` | Serve a specific snapshot image file |
| `POST` | `/command` | Send a command string to a connected device via TCP socket |
| `POST` | `/api/log-command` | Log an outgoing command (publishes to RabbitMQ log queue) |

#### SSE (Server-Sent Events)

| Endpoint | Event | Description |
|----------|-------|-------------|
| `GET /api/events/snapshots?mac=` | `snapshot` | Real-time notification when a new snapshot is captured for a device. Supports optional MAC filter. |

### Database Models

#### User (`models/User.js`)

```
{
  username: String (unique, required),
  password: String (required, bcrypt-hashed),
  role:     String (enum: 'admin', 'block', 'gp', 'user')
}
```

#### Device (`models/Device.js`)

```
{
  mac:        String (unique, required),  // IP address as identifier
  locationId: String,
  address:    String,
  latitude:   Number,
  longitude:  Number,
  ipCamera: {
    type: String,   // 'H' (HiFocus) or 'S' (Sparsh)
    ip:   String    // Camera IP address
  }
}
```

#### SensorReading (`models/SensorReading.js`)

```
{
  mac:                    String,
  humidity:               Number,
  insideTemperature:      Number,
  outsideTemperature:     Number,
  lockStatus:             String ('OPEN' / 'CLOSED'),
  doorStatus:             String ('OPEN' / 'CLOSED'),
  waterLogging:           Boolean,
  waterLeakage:           Boolean,
  outputVoltage:          Number,
  hupsDVC:                Number,
  inputVoltage:           Number,
  hupsBatVolt:            Number,
  batteryBackup:          Number,
  alarmActive:            Boolean,
  fireAlarm:              Number,
  fanLevel1Running:       Boolean,
  fanLevel2Running:       Boolean,
  fanLevel3Running:       Boolean,
  fanLevel4Running:       Boolean,
  pwsFailCount:           Number,
  fan1Status .. fan6Status: Number (0=off, 1=healthy, 2=faulty),
  mainStatus:             Number,   // HUPS alarm bits
  rectStatus:             Number,
  inveStatus:             Number,
  overStatus:             Number,
  mptStatus:              Number,
  mosfStatus:             Number,
  hupsRes:                Number,
  insideTemperatureAlarm: Boolean,  // threshold alarms
  outsideTemperatureAlarm: Boolean,
  humidityAlarm:          Boolean,
  inputVoltageAlarm:      Boolean,
  outputVoltageAlarm:     Boolean,
  batteryBackupAlarm:     Boolean,
  timestamp:              Date (default: Date.now)
}
```

### Message Queue (RabbitMQ)

#### Queues

| Queue | Publisher | Consumer | Purpose |
|-------|-----------|----------|---------|
| `alarm.queue` | TCP server (on threshold/status alarm) | Alarm Worker | Write alarm entries to per-device `.inc` log files |
| `snapshot.queue` | TCP server (on door-open + camera trigger) | Snapshot Worker | Capture image from IP camera (RTSP/HTTP) |
| `snapshot.done` | Snapshot Worker (on capture success) | TCP server (SSE broadcaster) | Notify frontend of new snapshot via SSE |
| `log.queue` | TCP server (incoming data) + HTTP API (outgoing commands) | Log Worker | Write incoming sensor logs (`.inc`) and outgoing command logs (`.out`) |

#### Workers

**Alarm Worker (`workers/alarmWorker.js`)**
- Consumes `alarm.queue`.
- Creates per-device directories under the configured alarm log path.
- Appends timestamped alarm entries (including fan status if faulty) to hourly `.inc` files.

**Snapshot Worker (`workers/snapshotWorker.js`)**
- Consumes `snapshot.queue` with prefetch of 50.
- Determines camera type from message payload:
  - **HiFocus (`H`):** Captures via `ffmpeg` RTSP stream (`rtsp://<ip>/media/video1`).
  - **Sparsh (`S`):** Captures via HTTP GET (`https://<ip>/CGI/command/snap?channel=01`).
- Saves image as `image_<DD_MM_YY_HH_MM_SS>.jpg` in per-device snapshot directory.
- Publishes completion event to `snapshot.done`.

**Log Worker (`workers/logWorker.js`)**
- Consumes `log.queue`.
- Routes to either `INC_LOG_DIR` (incoming sensor data) or `OUT_LOG_DIR` (outgoing commands) based on `data.type`.
- Creates per-device directories and appends to hourly log files.

### Simulator

The simulator (`simulator/simulate_IP.js`) emulates up to 100 IoT devices for development and testing.

**Key Features:**
- Generates unique `192.168.x.y` IPs for each simulated device.
- Supports two modes:
  - **Random mode:** Auto-generates sensor values with periodic alarm phases.
  - **CSV mode:** Replays pre-recorded sensor data from `sim_pack2.csv`.
- Exposes a **WebSocket server** (port 8090) allowing a browser-based UI (`simulator.html`) to adjust simulation parameters (temperatures, voltages, fan overrides, alarm triggers) in real time.
- Builds 58-byte binary packets matching the real device protocol and sends them over TCP.
- Simulates device disconnection/reconnection cycles.
- Implements a padding byte pulse (alternates `0x00` / `0x43`) to trigger camera snapshot logic on the server.

### Frontend

**Framework:** React 18 with Tailwind CSS

#### Pages and Routing

| Route | Component | Access |
|-------|-----------|--------|
| `/` | `Login` | Public |
| `/dashboard` | `DashboardView` | Roles: user, block, gp |
| `/dashboard-v2` | `DashboardViewV2` | Roles: user, block, gp |
| `/admin` | `AdminDashboard` | Role: admin |

Authentication uses JWT tokens stored client-side with role-based route protection via `PrivateRoute`.

#### Key Components

**DashboardView (`pages/DashboardView.js`)**
- Polls backend every 5 seconds for latest readings and device metadata.
- Computes per-device status: `connected`, `disconnected`, `status-alarm`, `gauge-alarm` based on reading staleness (30s threshold) and alarm state.
- Displays:
  - **Device tiles** with color-coded alarm status.
  - **Gauges** for temperature, humidity, voltage, battery backup.
  - **Leaflet map** with device markers and fly-to-device navigation.
  - **Snapshot viewer** with SSE-based real-time updates.
  - **Fan control buttons** and lock management (open, reset).
  - **Alarm log viewer** persisted to localStorage with hourly rotation.
- Sends device commands formatted as `%R0<level><N|F><datetime>$` (fan) and `%L00<O|P|R><data><datetime>$` (lock).

**AdminDashboard (`pages/AdminDashboard.js`)**
- Sidebar navigation with tabs:
  - **Register User:** CRUD for user accounts with password-protected edit/delete.
  - **Register Device:** CRUD for devices with IP, location, coordinates, and camera configuration.
  - **Console:** Embeds the `DashboardView` for monitoring.
  - **Historical Data:** Date picker + line charts (Recharts) for per-device historical sensor trends.

**DeviceMap (`components/DeviceMap.jsx`)**
- Leaflet map rendering registered device markers.
- Color-coded by device status.

**DevicePanel / DeviceTile (`components/DevicePanel.jsx`, `DeviceTile.jsx`)**
- Individual device cards showing summary status, alarm indicators, and quick actions.

**OfflinePrompt (`components/OfflinePrompt.js`)**
- Full-screen overlay shown when backend connectivity (`/ping`) is lost.

### Threshold and Alarm Engine

Thresholds are defined in `server/thresholds.js` (and mirrored in `iot-dashboard-frontend/src/config/thresholds.js`):

| Parameter | Min | Max |
|-----------|-----|-----|
| Inside Temperature | 0 | 55 |
| Outside Temperature | -20 | 65 |
| Humidity | 20 | 80 |
| Input Voltage | 40.0 | 65.0 |
| Output Voltage | 45.0 | 55.0 |
| Battery Backup | 6 hrs | 13 hrs |

**Server-side:** Evaluated on every incoming packet. Threshold violations, status alarms (fire, water, door, lock), and fan faults are combined into an `activeAlarms` array and published to the alarm queue.

**Client-side:** The dashboard independently computes alarm state from the latest readings for UI color-coding (green = connected, red = status alarm, yellow = gauge alarm, grey = disconnected).

### Cleanup and Maintenance

| Task | Frequency | Description |
|------|-----------|-------------|
| **DB Cleanup** | Hourly | Caps `SensorReading` collection at `MAX_SENSOR_DOCS` (default 50,000) by deleting oldest documents beyond the boundary |
| **Log File Cleanup** | Every 24 hours | Deletes `.inc` log files older than 3 days from the incoming log directory |
| **Bulk Buffer Flush** | Every 2 seconds | Flushes the in-memory reading buffer to MongoDB via `insertMany` (up to 1000 docs per flush) |
