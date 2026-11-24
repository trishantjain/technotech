# TechnoTech - Entity Management System (EMS)

A full-stack IoT-based Entity Management System for real-time monitoring and control of remote electrical/environmental equipment. The platform ingests live sensor data over TCP from field devices, processes alarms, captures IP camera snapshots, and presents everything through a responsive React dashboard.

---

## Table of Contents

- [Commands](#commands)
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
  - [Threshold and Alarm Engine](#threshold-and-alarm-engine)
  - [Cleanup and Maintenance](#cleanup-and-maintenance)

---

## Commands

- docker compose -f docker-compose.dev.yml up -d --build

## High-Level Design (HLD)

### System Overview

The EMS platform monitors remote telecom/electrical shelters equipped with IoT sensor boards. Each board periodically sends a binary packet (over TCP) containing environmental readings (temperature, humidity, voltage, etc.) and status flags (door, lock, fire alarm, water leakage, fan health). The backend ingests these packets, evaluates threshold-based alarms, persists readings to MongoDB, offloads heavy I/O tasks (alarm logging, snapshot capture, data logging) to RabbitMQ workers, and pushes real-time updates to the React frontend.

### Component Summary

| Component | Role |
| --------- | ---- |

| **IoT Sensor Board / Simulator**
| **Node.js Backend**  
| **React Frontend**  
| **MongoDB**  
| **RabbitMQ**  
| **Workers (Alarm, Snapshot, Log)**
| **Relay Server**

### Technology Stack

| Layer            | Technology                                                   |
| ---------------- | ------------------------------------------------------------ |
| Frontend         | React 18, Tailwind CSS, Recharts, React-Leaflet, SweetAlert2 |
| Backend          | Node.js, Express 5, Mongoose, JSON Web Tokens (JWT), bcrypt  |
| Database         | MongoDB 6                                                    |
| Message Broker   | RabbitMQ 3 (amqplib)                                         |
| Real-Time        | Server-Sent Events (SSE), raw TCP sockets                    |
| Containerization | Docker, Docker Compose                                       |
| CI/CD            | GitHub Actions -> EC2 (SSH deploy), Nginx                    |
| Simulator        | Node.js TCP client with WebSocket UI control                 |

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

### Frontend

**Framework:** React 18 with Tailwind CSS

#### Pages and Routing

#### Key Components

**DashboardView (`pages/DashboardView.js`)**
**AdminDashboard (`pages/AdminDashboard.js`)**
**DeviceMap (`components/DeviceMap.jsx`)**
**OfflinePrompt (`components/OfflinePrompt.js`)**
