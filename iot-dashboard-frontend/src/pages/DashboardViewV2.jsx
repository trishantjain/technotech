import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { KeyRound, LockKeyhole, Power, RotateCcw } from "lucide-react";
import "../styles/dashboard-v2.css";
import thresholds from "../config/thresholds";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const STALE_THRESHOLD_MS = 30000;
const defaultLocation = [28.6139, 77.209];

function alarmComputation(reading, thresholdConfig) {
  if (!reading) return { active: false, alarms: [] };

  const alarms = [];
  if (reading.fireAlarm) alarms.push("Fire Alarm");
  if (reading.waterLeakage) alarms.push("Water Leakage");
  if (reading.waterLogging) alarms.push("Water Logging");
  if (reading.lockStatus === "OPEN") alarms.push("Lock Open");
  if (reading.doorStatus === "OPEN") alarms.push("Door Open");
  if (reading.pwsFailCount === 3) alarms.push("Password Blocked");

  if (
    reading.insideTemperatureAlarm &&
    Number(reading.insideTemperature) < thresholdConfig.insideTemperature.min
  ) {
    alarms.push("Low Inside Temperature Alarm");
  }
  if (reading.outsideTemperatureAlarm) alarms.push("Outside Temp Alarm");
  if (reading.humidityAlarm) alarms.push("Humidity Alarm");
  if (reading.inputVoltageAlarm) alarms.push("Input Voltage Alarm");
  if (reading.outputVoltageAlarm) alarms.push("Output Voltage Alarm");
  if (reading.batteryBackupAlarm) alarms.push("Battery Alarm");

  return { active: alarms.length > 0, alarms };
}

function getDeviceStatusClass(reading) {
  if (!reading?.timestamp) return "disconnected";

  const age = Date.now() - new Date(reading.timestamp).getTime();
  if (age > STALE_THRESHOLD_MS) return "disconnected";

  const hasStatusAlarm =
    reading.fireAlarm ||
    reading.waterLeakage ||
    reading.waterLogging ||
    reading.lockStatus === "OPEN" ||
    reading.doorStatus === "OPEN" ||
    [1, 2, 3].includes(Number(reading.password));

  if (hasStatusAlarm) return "status-alarm";

  const hasGaugeAlarm =
    reading.insideTemperatureAlarm ||
    reading.outsideTemperatureAlarm ||
    reading.humidityAlarm ||
    reading.inputVoltageAlarm ||
    reading.outputVoltageAlarm ||
    reading.batteryBackupAlarm;

  return hasGaugeAlarm ? "gauge-alarm" : "connected";
}

function gaugeColor(value, min, max) {
  if (value < min) return "#f59e0b";
  if (value >= max) return "#ef4444";
  return "#84cc16";
}

function GaugeTile({ label, value, max, color, textColor, trailColor }) {
  return (
    <div className="v2-gauge-tile">
      <div className="v2-gauge-ring">
        <CircularProgressbar
          value={Number(value) || 0}
          maxValue={max}
          text={String(value)}
          styles={buildStyles({
            pathColor: color,
            textColor,
            trailColor,
          })}
        />
      </div>
      <div className="v2-gauge-label">{label}</div>
    </div>
  );
}

export default function DashboardViewV2() {
  const alarmKeys = [
    { key: "fireAlarm", name: "Fire Alarm" },
    { key: "waterLogging", name: "Logging" },
    { key: "waterLeakage", name: "Leakage" },
  ];

  const statusKeys = [
    { key: "lockStatus", name: "Lock" },
    { key: "doorStatus", name: "Door" },
    { key: "pwsFailCount", name: "Password" },
  ];

  const hupsKeys = [
    { key: "mainStatus", name: "Main" },
    { key: "rectStatus", name: "Rectifier" },
    { key: "inveStatus", name: "Inverter" },
    { key: "overStatus", name: "O.Load" },
    { key: "mptStatus", name: "MPT" },
    { key: "mosfStatus", name: "MOSFET" },
  ];

  const [readings, setReadings] = useState([]);
  const [deviceMeta, setDeviceMeta] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [showDeviceList, setShowDeviceList] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [themeMode, setThemeMode] = useState("dark");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [statusTab, setStatusTab] = useState("status");
  const [statusMsg, setStatusMsg] = useState("");
  const [activeFanBtns, setActiveFanBtns] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const selectedMacRef = useRef("");

  useEffect(() => {
    selectedMacRef.current = selectedMac;
  }, [selectedMac]);

  useEffect(() => {
    const savedTheme = window?.localStorage?.getItem("tt.v2.theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setThemeMode(savedTheme);
    }
  }, []);

  useEffect(() => {
    try {
      window?.localStorage?.setItem("tt.v2.theme", themeMode);
    } catch {
      // ignore
    }
  }, [themeMode]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [readingsRes, metaRes] = await Promise.all([
          fetch(`${process.env.REACT_APP_API_URL}/api/readings`),
          fetch(`${process.env.REACT_APP_API_URL}/api/devices-info`),
        ]);

        const readingsData = readingsRes.ok ? await readingsRes.json() : [];
        const metaData = metaRes.ok ? await metaRes.json() : [];

        setReadings(Array.isArray(readingsData) ? readingsData : []);
        setDeviceMeta(Array.isArray(metaData) ? metaData : []);
      } catch {
        setReadings([]);
        setDeviceMeta([]);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedMac && deviceMeta.length > 0) {
      setSelectedMac(deviceMeta[0].mac);
    }
  }, [deviceMeta, selectedMac]);

  const latestReadingsByMac = useMemo(() => {
    const map = {};
    for (const reading of readings) {
      const existing = map[reading.mac];
      if (!existing || new Date(reading.timestamp) > new Date(existing.timestamp)) {
        map[reading.mac] = reading;
      }
    }
    return map;
  }, [readings]);

  const selectedReading = latestReadingsByMac[selectedMac] || null;
  const selectedAlarmResult = useMemo(
    () => alarmComputation(selectedReading, thresholds),
    [selectedReading]
  );
  const selectedAlarms = selectedAlarmResult.alarms;

  useEffect(() => {
    if (!selectedMac || selectedAlarms.length === 0) return;

    const event = {
      id: `${Date.now()}-${selectedMac}`,
      ts: new Date().toLocaleTimeString(),
      message: `[${selectedMac}] ${selectedAlarms.join(", ")}`,
    };

    setRecentEvents((prev) => [event, ...prev].slice(0, 60));
  }, [selectedMac, selectedAlarms]);

  function getFormattedDateTime() {
    const today = new Date();
    const addLeadingZero = (num) => String(num).padStart(2, "0");
    const dd = addLeadingZero(today.getDate());
    const mm = addLeadingZero(today.getMonth() + 1);
    const yy = String(today.getFullYear()).slice(-2);
    const HH = addLeadingZero(today.getHours());
    const MM = addLeadingZero(today.getMinutes());
    const SS = addLeadingZero(today.getSeconds());
    return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
  }

  const sendToLog = async (status, message, command = "") => {
    const logData = {
      date: new Date().toLocaleString(),
      mac: selectedMac,
      command,
      status,
      message,
    };

    try {
      await fetch(`${process.env.REACT_APP_API_URL}/api/log-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logData),
      });
    } catch {
      // ignore
    }
  };

  const sendCommand = async (cmdToSend) => {
    if (!selectedMac || !cmdToSend) {
      setStatusMsg("Please select a device and enter a command.");
      return;
    }
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: selectedMac, command: cmdToSend }),
      });
      const data = await res.json();
      setStatusMsg(data.message || "Command sent");
    } catch {
      setStatusMsg("Error sending command");
    }
  };

  const handleFanClick = (level) => {
    const isActive = activeFanBtns.includes(level);
    const command = isActive
      ? `%R0${level}F${getFormattedDateTime()}$`
      : `%R0${level}N${getFormattedDateTime()}$`;

    if (level !== 5) {
      sendToLog(`Fan Group ${level} clicked ${isActive ? "off" : "on "}`, "", command);
    } else {
      sendToLog(`LOAD Clicked ${isActive ? "off" : "on "}`, "", command);
    }
    sendCommand(command);
    setActiveFanBtns((prev) =>
      isActive ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const handleOpenLock = async () => {
    const password = window.prompt("Enter Admin password");
    if (!password) return;
    if (password === "admin123") {
      sendCommand(`%L00O${getFormattedDateTime()}$`);
      sendToLog("Password Open Button Clicked", "");
      setStatusMsg("Lock opened successfully!");
    } else {
      setStatusMsg("Wrong password!");
    }
  };

  const handleResetLock = () => {
    const pwd = window.prompt("Enter admin password to reset lock:");
    if (pwd !== "admin123") {
      setStatusMsg("Wrong password for resetting lock!");
      return;
    }
    const newLock = window.prompt("Enter new lock value:");
    if (!/^\d{9}$/.test(newLock || "")) {
      setStatusMsg("Enter Numeric Password of 9 Digits");
      return;
    }
    sendToLog(`Lock Reset ${newLock} clicked`, "");
    sendCommand(`%L00R${newLock}${getFormattedDateTime()}$$`);
    setStatusMsg(`New password ${newLock}`);
  };

  const openPassword = () => {
    const pwd = window.prompt("Enter admin password to Open Lock:");
    if (pwd === "admin123") {
      sendCommand(`%L00P${getFormattedDateTime()}$`);
    } else {
      setStatusMsg("Wrong password for opening lock!");
    }
  };

  const fetchSnapshots = async (mac) => {
    try {
      if (!mac) {
        setSnapshots([]);
        return;
      }
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/snapshots/?mac=${mac}`);
      const snapshotFiles = await response.json();
      setSnapshots(Array.isArray(snapshotFiles) ? snapshotFiles : []);
    } catch {
      setSnapshots([]);
    }
  };

  useEffect(() => {
    fetchSnapshots(selectedMac);
    const snapshotInterval = setInterval(() => {
      fetchSnapshots(selectedMacRef.current);
    }, 240000);
    return () => clearInterval(snapshotInterval);
  }, [selectedMac]);

  useEffect(() => {
    const baseUrl = process.env.REACT_APP_API_URL;
    if (!baseUrl) return;
    const es = new EventSource(`${baseUrl}/api/events/snapshots`);
    const onSnapshot = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        const mac = payload?.mac;
        if (!mac) return;
        if (String(selectedMacRef.current).toLowerCase() === String(mac).toLowerCase()) {
          fetchSnapshots(selectedMacRef.current);
        }
      } catch {
        // ignore
      }
    };
    es.addEventListener("snapshot", onSnapshot);
    return () => {
      try {
        es.removeEventListener("snapshot", onSnapshot);
        es.close();
      } catch {
        // ignore
      }
    };
  }, []);

  // const selectedLastSeen = selectedReading?.timestamp
  //   ? new Date(selectedReading.timestamp).toLocaleTimeString()
  //   : "No data";

  // const selectedAge = selectedReading?.timestamp
  //   ? Date.now() - new Date(selectedReading.timestamp).getTime()
  //   : Infinity;

  // const selectedState = selectedAge > STALE_THRESHOLD_MS
  //   ? "Disconnected"
  //   : selectedAlarmResult.active
  //     ? "Alarm"
  //     : "Healthy";

  // const selectedStateClass = selectedState === "Healthy"
  //   ? "state-healthy"
  //   : selectedState === "Alarm"
  //     ? "state-alarm"
  //     : "state-disconnected";

  // const focusMonitoringMode = !showDeviceList && !showMap;

  const gaugeItems = selectedReading
    ? [
        {
          label: "Inside Temp",
          value: Number(selectedReading.insideTemperature).toFixed(2),
          max: 100,
          color: gaugeColor(selectedReading.insideTemperature, thresholds.insideTemperature.min, thresholds.insideTemperature.max),
        },
        {
          label: "Outside Temp",
          value: Number(selectedReading.outsideTemperature).toFixed(2),
          max: 100,
          color: gaugeColor(selectedReading.outsideTemperature, thresholds.outsideTemperature.min, thresholds.outsideTemperature.max),
        },
        {
          label: "Humidity",
          value: Number(selectedReading.humidity).toFixed(2),
          max: 100,
          color: gaugeColor(selectedReading.humidity, thresholds.humidity.min, thresholds.humidity.max),
        },
        {
          label: "Input Volt",
          value: Number(selectedReading.inputVoltage).toFixed(2),
          max: 100,
          color: gaugeColor(selectedReading.inputVoltage, thresholds.inputVoltage.min, thresholds.inputVoltage.max),
        },
        {
          label: "Output Volt",
          value: Number(selectedReading.outputVoltage).toFixed(2),
          max: 100,
          color: gaugeColor(selectedReading.outputVoltage, thresholds.outputVoltage.min, thresholds.outputVoltage.max),
        },
        {
          label: "Battery %",
          value: Number(selectedReading.batteryBackup * 1.5).toFixed(2),
          max: 120,
          color: "#facc15",
        },
        {
          label: "Battery(Hours)",
          value: Number(selectedReading.batteryBackup).toFixed(2),
          max: 120,
          color: "#facc15",
        },
        {
          label: "DV Current",
          value: Number(selectedReading.batteryBackup).toFixed(2),
          max: 45,
          color: "#facc15",
        },
        {
          label: "LockBat(Left..)",
          value:
            Number(selectedReading.batteryBackup) <= 10
              ? 0
              : Math.floor((Number(selectedReading.batteryBackup) - 9) * 4),
          max: 12,
          color:
            Number(selectedReading.batteryBackup) <= thresholds.batteryBackup.min
              ? "#ef4444"
              : "#84cc16",
        },
      ]
    : [];

  const deviceList = useMemo(() => {
    const priority = {
      "status-alarm": 1,
      "gauge-alarm": 1,
      connected: 3,
      disconnected: 0,
    };

    return [...deviceMeta]
      .map((device) => {
        const reading = latestReadingsByMac[device.mac];
        const statusClass = getDeviceStatusClass(reading);
        return { ...device, statusClass };
      })
      .sort((a, b) => priority[a.statusClass] - priority[b.statusClass]);
  }, [deviceMeta, latestReadingsByMac]);
  const filteredDeviceList = useMemo(() => {
    const query = deviceQuery.trim().toLowerCase();
    return deviceList.filter((device) => {
      const inFilter =
        deviceFilter === "all"
          ? true
          : deviceFilter === "connected"
            ? device.statusClass === "connected"
            : deviceFilter === "disconnected"
              ? device.statusClass === "disconnected"
              : device.statusClass === "status-alarm" || device.statusClass === "gauge-alarm";

      if (!inFilter) return false;

      if (!query) return true;
      const location = String(device.locationId || "").toLowerCase();
      const mac = String(device.mac || "").toLowerCase();
      return location.includes(query) || mac.includes(query);
    });
  }, [deviceList, deviceQuery, deviceFilter]);
  const connectedCount = useMemo(
    () => deviceList.filter((d) => d.statusClass === "connected").length,
    [deviceList]
  );
  const disconnectedCount = useMemo(
    () => deviceList.filter((d) => d.statusClass === "disconnected").length,
    [deviceList]
  );
  const alarmsCount = useMemo(
    () => deviceList.filter((d) => d.statusClass === "status-alarm" || d.statusClass === "gauge-alarm").length,
    [deviceList]
  );

  const gaugeTextColor = themeMode === "dark" ? "#f8fafc" : "#1f2937";
  const gaugeTrailColor = themeMode === "dark" ? "#334155" : "#c4ceda";
  const selectedDevice = deviceMeta.find((d) => d.mac === selectedMac);
  const selectedLat = parseFloat(selectedDevice?.latitude);
  const selectedLon = parseFloat(selectedDevice?.longitude);
  const selectedCenter =
    !Number.isNaN(selectedLat) && !Number.isNaN(selectedLon)
      ? [selectedLat, selectedLon]
      : defaultLocation;

  return (
    <div className={`v2-shell v2-theme-${themeMode}`}>
      <div className="v2-container">
        <div className="v2-grid">
          {/* <Card className="v2-span-2">
            <CardContent>
              <div className="v2-summary-grid">
                <div className={`v2-summary-tile ${selectedStateClass}`}>
                  <div className="v2-summary-label">Device State</div>
                  <div className="v2-summary-value">{selectedState}</div>
                  <div className="v2-summary-meta">Last seen: {selectedLastSeen}</div>
                </div>

                <div className="v2-summary-tile">
                  <div className="v2-summary-label">Active Alarms</div>
                  <div className="v2-summary-value">{selectedAlarms.length}</div>
                  <div className="v2-summary-meta">{selectedAlarms.slice(0, 2).join(" | ") || "No active alarms"}</div>
                </div>

                <div className="v2-summary-tile">
                  <div className="v2-summary-label">Selected Rack</div>
                  <div className="v2-summary-value v2-mac">{selectedMac || "Select device"}</div>
                  <div className="v2-summary-meta">Focus mode: {focusMonitoringMode ? "ON" : "OFF"}</div>
                </div>
              </div>
            </CardContent>
          </Card> */}

          <Card className="v2-gauge-panel">
            <CardHeader>
              <CardTitle>Gauge Monitoring: {selectedDevice?.locationId || "Select device"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="v2-gauge-grid">
                {gaugeItems.length > 0 ? (
                  gaugeItems.map((item) => (
                    <GaugeTile
                      key={item.label}
                      label={item.label}
                      value={item.value}
                      max={item.max}
                      color={item.color}
                      textColor={gaugeTextColor}
                      trailColor={gaugeTrailColor}
                    />
                  ))
                ) : (
                  <div className="v2-empty">No devices available.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {showDeviceList && (
            <Card className="v2-device-panel">
              <CardHeader>
                <CardTitle>Devices</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="v2-device-tools">
                  <input
                    type="text"
                    className="v2-device-search"
                    placeholder="Search by rack or MAC..."
                    value={deviceQuery}
                    onChange={(e) => setDeviceQuery(e.target.value)}
                  />
                  <span className="v2-device-count">{filteredDeviceList.length}</span>
                </div>
                <div className="v2-device-filter-row">
                  <button
                    type="button"
                    className={`v2-device-filter-btn ${deviceFilter === "connected" ? "active" : ""}`}
                    onClick={() => setDeviceFilter((prev) => (prev === "connected" ? "all" : "connected"))}
                  >
                    Connected ({connectedCount})
                  </button>
                  <button
                    type="button"
                    className={`v2-device-filter-btn ${deviceFilter === "disconnected" ? "active" : ""}`}
                    onClick={() => setDeviceFilter((prev) => (prev === "disconnected" ? "all" : "disconnected"))}
                  >
                    Disconnected ({disconnectedCount})
                  </button>
                  <button
                    type="button"
                    className={`v2-device-filter-btn ${deviceFilter === "alarms" ? "active" : ""}`}
                    onClick={() => setDeviceFilter((prev) => (prev === "alarms" ? "all" : "alarms"))}
                  >
                    Alarms ({alarmsCount})
                  </button>
                </div>
                <div className="v2-device-grid">
                  {filteredDeviceList.map((device) => {
                    return (
                      <button
                        key={device.mac}
                        className={`v2-device-tile ${device.statusClass} ${selectedMac === device.mac ? "active" : ""}`}
                        onClick={() => setSelectedMac(device.mac)}
                        type="button"
                      >
                        <div className="v2-device-name">{device.locationId || device.mac}</div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="v2-status-panel">
            <CardHeader className="v2-card-header-row">
              <CardTitle>Status Overview</CardTitle>
              <div className="v2-inline-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
                >
                  {themeMode === "dark" ? "Light Theme" : "Dark Theme"}
                </Button>
                <Button
                  variant={showDeviceList ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setShowDeviceList((prev) => !prev)}
                >
                  {showDeviceList ? "Hide Devices" : "Show Devices"}
                </Button>
                <Button
                  variant={showMap ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setShowMap((prev) => !prev)}
                >
                  {showMap ? "Hide Map" : "Show Map"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="v2-status-tabs">
                <button
                  type="button"
                  className={`v2-status-tab-btn ${statusTab === "status" ? "active" : ""}`}
                  onClick={() => setStatusTab("status")}
                >
                  Status
                </button>
                <button
                  type="button"
                  className={`v2-status-tab-btn ${statusTab === "snapshots" ? "active" : ""}`}
                  onClick={() => setStatusTab("snapshots")}
                >
                  Snapshots
                </button>
              </div>

              {statusTab === "status" ? (
                <>
                  <div className="v2-status-row">
                    <div className="v2-status-title">Fan Running Status</div>
                    {[...Array(6)].map((_, i) => {
                      const fanStatus = selectedReading?.[`fan${i + 1}Status`];
                      const fanClass = fanStatus === 1 ? "ok" : fanStatus === 2 ? "danger" : "off";
                      return (
                        <div key={`fan-${i + 1}`} className="v2-indicator">
                          <span className={`v2-led ${fanClass}`} />
                          <span className="v2-indicator-label">F{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="v2-status-row">
                    <div className="v2-status-title">Alarms</div>
                    {alarmKeys.map((item) => {
                      const active = Boolean(selectedReading?.[item.key]);
                      return (
                        <div key={item.key} className="v2-indicator">
                          <span className={`v2-led ${active ? "danger" : "off"}`} />
                          <span className="v2-indicator-label">{item.name}</span>
                        </div>
                      );
                    })}
                    {statusKeys.map((item) => {
                      const raw = selectedReading?.[item.key];
                      let ledClass = "off";
                      let extraText = "";

                      if (item.key === "pwsFailCount") {
                        const attempts = Number(raw) || 0;
                        ledClass = attempts >= 3 ? "danger" : attempts === 2 ? "warn" : attempts === 1 ? "active" : "off";
                        extraText = attempts > 0 ? `${Math.max(0, 3 - attempts)} left` : "";
                      } else {
                        ledClass = raw === "OPEN" ? "danger" : "off";
                      }

                      return (
                        <div key={item.key} className="v2-indicator">
                          <span className={`v2-led ${ledClass}`} />
                          <span className="v2-indicator-label">{item.name}</span>
                          {extraText ? <span className="v2-indicator-sub">{extraText}</span> : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="v2-status-row">
                    <div className="v2-status-title">HUPS</div>
                    {hupsKeys.map((item) => {
                      const active = Boolean(selectedReading?.[item.key]);
                      return (
                        <div key={item.key} className="v2-indicator">
                          <span className={`v2-led ${active ? "danger" : "off"}`} />
                          <span className="v2-indicator-label">{item.name}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="v2-status-row v2-command-row">
                    <div className="v2-command-grid">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div key={level} className="v2-command-item">
                          <button
                            className={`v2-command-btn ${activeFanBtns.includes(level) || selectedReading?.[`fanLevel${level}Running`] ? "active" : ""}`}
                            type="button"
                            onClick={() => handleFanClick(level)}
                            aria-label={level <= 4 ? `FG ${level}` : "LOAD"}
                          >
                            <Power size={14} />
                          </button>
                          <span className="v2-command-label">{level <= 4 ? `FG ${level}` : "LOAD"}</span>
                        </div>
                      ))}
                      <button className="v2-lock-btn" type="button" onClick={handleOpenLock}>
                        <LockKeyhole size={14} />
                        <span>Lock</span>
                      </button>
                      <button className="v2-lock-btn" type="button" onClick={handleResetLock}>
                        <RotateCcw size={14} />
                        <span>Reset</span>
                      </button>
                      <button className="v2-lock-btn" type="button" onClick={openPassword}>
                        <KeyRound size={14} />
                        <span>Open PWD</span>
                      </button>
                    </div>
                  </div>
                  {statusMsg ? <div className="v2-status-msg">{statusMsg}</div> : null}
                </>
              ) : (
                <div className="v2-status-tab-pane">
                  <div className="v2-mini-snapshot-grid">
                    {snapshots.length > 0 ? (
                      snapshots.map((filename) => (
                        <button
                          key={`status-${filename}`}
                          type="button"
                          className="v2-mini-snapshot-item"
                          onClick={() =>
                            setSelectedImage(`${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`)
                          }
                        >
                          <img
                            src={`${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`}
                            alt={filename}
                          />
                        </button>
                      ))
                    ) : (
                      <div className="v2-empty">No snapshots available.</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {showMap && (
            <Card className="v2-map-panel">
              <CardHeader>
                <CardTitle>Map Panel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="v2-map-wrap">
                  <MapContainer
                    key={`${selectedCenter[0]}-${selectedCenter[1]}`}
                    center={selectedCenter}
                    zoom={13}
                    scrollWheelZoom
                    className="v2-map"
                  >
                    <TileLayer
                      url={
                        themeMode === "dark"
                          ? "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
                          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      }
                    />
                    {deviceList.map((device) => {
                      const lat = parseFloat(device.latitude);
                      const lon = parseFloat(device.longitude);
                      if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

                      const icon = L.divIcon({
                        className: "v2-map-marker",
                        html: `<div class="v2-map-dot ${device.statusClass}"></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8],
                      });

                      return (
                        <Marker key={device.mac} position={[lat, lon]} icon={icon}>
                          <Popup>
                            {device.locationId || device.mac}
                            <br />
                            {device.address || ""}
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="v2-alarm-panel">
            <CardHeader>
              <CardTitle>Alarm and Log Stream</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="v2-badge-wrap">
                {selectedAlarms.length > 0 ? (
                  selectedAlarms.map((alarm) => (
                    <Badge key={alarm} variant="danger">{alarm}</Badge>
                  ))
                ) : (
                  <Badge variant="success">No active alarms</Badge>
                )}
              </div>

              <div className="v2-log-box">
                {recentEvents.length > 0 ? (
                  recentEvents.map((event) => (
                    <div key={event.id} className="v2-log-line">[{event.ts}] {event.message}</div>
                  ))
                ) : (
                  <div className="v2-empty">No alarm events yet.</div>
                )}
              </div>
            </CardContent>
          </Card>

{/* SNAPSHOT SECTION */}
          {/* <Card className="v2-snapshot-panel">
            <CardHeader>
              <CardTitle>Snapshots</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="v2-snapshot-grid">
                {snapshots.length > 0 ? snapshots.map((filename) => (
                  <button
                    key={filename}
                    type="button"
                    className="v2-snapshot-item"
                    onClick={() =>
                      setSelectedImage(`${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`)
                    }
                  >
                    <img
                      src={`${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`}
                      alt={filename}
                    />
                    <span>{filename}</span>
                  </button>
                )) : (
                  <div className="v2-empty">No snapshots available.</div>
                )}
              </div>
            </CardContent>
          </Card> */}

        </div>
      </div>
      {selectedImage && (
        <div className="v2-image-modal" onClick={() => setSelectedImage(null)}>
          <img src={selectedImage} alt="Snapshot preview" className="v2-image-preview" />
        </div>
      )}
    </div>
  );
}
