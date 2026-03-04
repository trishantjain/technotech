import React, { useEffect, useState, useRef, useCallback } from "react";
import "../App.css";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
// import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
// import L from "leaflet";
// import {
//   LineChart,
//   Line,
//   XAxis,
//   YAxis,
//   CartesianGrid,
//   Tooltip,
//   Legend,
//   ResponsiveContainer,
// } from "recharts";
import swal from "sweetalert2";
import { useMemo } from "react";
import thresholds from "../config/thresholds";
import DeviceMap from "../components/DeviceMap";
import DevicePanel from "../components/DevicePanel";
import { ADMIN_PASSWORD, ALARM_KEYS, HUPS_KEYS, LOG_CONSTANTS, STATUS_KEYS } from "../config/constants.js";
import { getFormattedDateTime } from "../utils/date.js";
import { API } from "../config/api.js";
// import thresholds from "../../../server/thresholds";
// import GaugeComponent from 'react-gauge-component';

// const defaultLocation = [28.6139, 77.209];

const STALE_THRESHOLD_MS = 30000; // 30 seconds

const LOG_STORAGE_KEY = "tt.logsByMac.v1";
const { LOG_RESET_MS, MAX_LOGS_PER_DEVICE, LOG_THROTTLE_MS } = LOG_CONSTANTS; // 1 hour
// const {  } = CONSTANTS;
// const LOG_THROTTLE_MS = 5000; // log at most once per 5 seconds per device
const EMPTY_LOGS = [];

function DashboardView() {
  const [readings, setReadings] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceMeta, setDeviceMeta] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState("gauges");
  const [activeFanBtns, setActiveFanBtns] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [snapshots, setSnapshots] = useState([]);
  // const [videosCaptured, setVideosCaptured] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState("");

  const selectedMacRef = useRef("");
  const deviceStatusRef = useRef({});

  const [deviceStatusMap, setDeviceStatusMap] = useState({});

  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(true);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    selectedMacRef.current = selectedMac;
  }, [selectedMac]);

  const [alarmToggle, setAlarmToggle] = useState(false);


  // LOGS
  const lastResetAtRef = useRef(Date.now());
  const lastAlarmLogAtByMacRef = useRef({});

  /**
   * Reads and parses logs from localStorage with age validation
   * 
   * @returns {Object} An object containing logs indexed by MAC address, or an empty object if:
   *   - localStorage is empty or data is invalid
   *   - logs have expired based on LOG_RESET_MS window
   *   - JSON parsing fails
   * 
   * @description
   * Attempts to retrieve logs from localStorage using LOG_STORAGE_KEY.
   * Validates the stored data structure and checks if logs have exceeded
   * the reset time window (LOG_RESET_MS). Updates lastResetAtRef.current
   * with the timestamp if available. Returns empty object on any error.
   */
  const readLogsLocalStorage = () => {
    try {
      // Reading from local storage
      const raw = window?.localStorage?.getItem(LOG_STORAGE_KEY);
      if (!raw) return {};
      // Parsing JSON
      const parsed = JSON.parse(raw);
      const lastResetAt = Number(parsed?.lastResetAt || 0);
      // Logs by mac
      const stored = parsed?.logsByMac;

      // If Logs are not correct || not present
      if (!stored || typeof stored !== "object") return {};

      // If Last Reset variable is fetched than Update 'lastResetAtRef'
      if (lastResetAt) {
        lastResetAtRef.current = lastResetAt;
      }

      // If Logs are older than the reset window, start fresh
      if (lastResetAt && Date.now() - lastResetAt >= LOG_RESET_MS) {
        return {};
      }
      return stored;
    } catch {
      return {};
    }
  };

  const saveLogsLocalStorage = (nextLogsByMac) => {
    try {
      window?.localStorage?.setItem(
        LOG_STORAGE_KEY,
        JSON.stringify({
          lastResetAt: lastResetAtRef.current,
          logsByMac: nextLogsByMac,
        })
      );
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  };

  const [logsByMac, setLogsByMac] = useState(() => readLogsLocalStorage());

  // STORING LOG OF SELECTED DEVICE 
  const currentLogs = useMemo(
    () => logsByMac[selectedMac] || EMPTY_LOGS,
    [logsByMac, selectedMac]
  );

  // const _viewportRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const bottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const persistTimerRef = useRef(null);


  //Map and marker refs
  const mapRef = useRef(null);
  // const markerRefs = useRef({});
  // const isFetchingRef = useRef(false); // TIMING TESTING



  // const latestReadingsByMac = {};
  // readings.forEach((r) => {
  //   const existing = latestReadingsByMac[r.mac];
  //   if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
  //     latestReadingsByMac[r.mac] = r;
  //   }
  // });

  // In this code 'latestReadingsByMac' this only computed only when readings change
  const latestReadingsByMac = useMemo(() => {
    const map = {};
    for (const r of readings) {
      const existing = map[r.mac];
      if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
        map[r.mac] = r;
      }
    }
    return map;
  }, [readings]);

  const connectedDeviceCount = useMemo(() => {
    let connected = 0;
    let statusAlarm = 0;
    let gaugeAlarm = 0;
    let disconnected = 0;

    let count = 0;
    for (const mac in deviceStatusMap) {
      const status = deviceStatusMap[mac];

      if (status === "connected") connected++;
      else if (status === "status-alarm") statusAlarm++;
      else if (status === "gauge-alarm") gaugeAlarm++;
      else if (status === "disconnected") disconnected++;
    }

    return {
      connected,
      statusAlarm,
      gaugeAlarm,
      disconnected,
      total: deviceMeta.length
    };

  }, [deviceStatusMap, deviceMeta.length]);

  const frontendAlarmsByMac = useMemo(() => {
    const map = {};
    for (const mac in latestReadingsByMac) {
      map[mac] = alarmComputation(
        latestReadingsByMac[mac],
        thresholds
      );
    }
    return map;
  }, [latestReadingsByMac]);


  const selectedDeviceMeta = deviceMeta.find((d) => d.mac === selectedMac);
  const latestReading = readings.find((r) => r.mac === selectedMac);


  // UseEffect for fetching Data
  useEffect(() => {
    // console.log('🚨Starting data fetch interval (5s)🚨');
    const interval = setInterval(fetchData, 5000);

    fetchData();

    // console.log('🚨Fetching Data🚨')
    // return () => clearInterval(interval);
    return () => {
      // console.log('🛑Clearing data fetch interval');
      clearInterval(interval);
    };

  }, []);

  // 🔄 Auto-focus map on selected device
  useEffect(() => {
    if (mapRef.current && selectedMac) {
      const selectedDevice = deviceMeta.find((d) => d.mac === selectedMac);
      const lat = parseFloat(selectedDevice?.latitude);
      const lon = parseFloat(selectedDevice?.longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        mapRef.current.flyTo([lat, lon], 15, { duration: 1.5 });
        // console.log(`🔍 Flying to ${selectedMac} at [${lat}, ${lon}]`);
      }
    }
  }, [selectedMac, deviceMeta]);

  useEffect(() => {
    const iframe = document.querySelector(".camera-iframe");
    if (iframe) {
      iframe.style.transform = `scale(${zoom}) rotate(${rotation}deg)`;
    }
  }, [zoom, rotation]);

  function shallowEqualDevices(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (a[i].mac !== b[i].mac) return false;
    }
    return true;
  }


  // FETCH DATA
  const fetchData = async () => {
    try {
      if (!hasLoadedOnceRef.current) {
        setLoadingDevices(true);
      }

      const [readingsRes, devicesRes, deviceMetaRes] = await Promise.all([
        fetch(`${process.env.REACT_APP_API_URL}/${API.readings}`),
        fetch(`${process.env.REACT_APP_API_URL}/${API.allDevices}`),
        fetch(`${process.env.REACT_APP_API_URL}/${API.deviceInfo}`),
      ]);

      // Fallback to [] if any response fails
      let readingsData = [],
        devicesData = [],
        metadata = [];

      if (readingsRes.ok) readingsData = await readingsRes.json();
      if (devicesRes.ok) devicesData = await devicesRes.json();
      if (deviceMetaRes.ok) metadata = await deviceMetaRes.json();

      setReadings(Array.isArray(readingsData) ? readingsData : []);
      setDevices(Array.isArray(devicesData) ? devicesData : []);
      // setDeviceMeta(Array.isArray(metadata) ? metadata : []);

      setDeviceMeta(prev => {
        const next = Array.isArray(metadata) ? metadata : [];

        if (shallowEqualDevices(prev, next)) {
          return prev; // ✅ KEEP SAME REFERENCE
        }
        return next;
      });

      // console.log("readingData", readingsData);
    } catch (err) {
      console.error("❌Error fetching data:", err);
    } finally {
      if (!hasLoadedOnceRef.current) {
        setLoadingDevices(false);
        hasLoadedOnceRef.current = true;
      }
    }
  };


  // function shallowEqualDevices(a, b) {
  //   if (a === b) return true;
  //   if (!a || !b) return false;
  //   if (a.length !== b.length) return false;

  //   for (let i = 0; i < a.length; i++) {
  //     if (a[i].mac !== b[i].mac) return false;
  //   }
  //   return true;
  // }

  // const handleMapCreated = (mapInstance) => {
  //   if (!mapRef.current) {
  //     mapRef.current = mapInstance;
  //     // console.log("Map ref set:", mapRef.current); // <--- You should see this log ONCE
  //   }
  // };

  const handleSelectDevice = useCallback((mac, locationId) => {
    setSelectedMac(mac);
    setSelectedDevice(locationId);
  }, []);


  // added by vats
  // A synchronous function to format the date and time.
  // function getFormattedDateTime() {
  //   const today = new Date();
  //   const addLeadingZero = (num) => String(num).padStart(2, "0");

  //   const dd = addLeadingZero(today.getDate());
  //   const mm = addLeadingZero(today.getMonth() + 1);
  //   const yy = String(today.getFullYear()).slice(-2);
  //   const HH = addLeadingZero(today.getHours());
  //   const MM = addLeadingZero(today.getMinutes());
  //   const SS = addLeadingZero(today.getSeconds());

  //   return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
  // }

  // LOGGING COMMANDS IN SYSTEM
  const sendToLog = async (status, message, command = "") => {
    const logData = {
      date: new Date().toLocaleString(),
      mac: selectedMac,
      command: command,
      status: status,
      message: message,
    };

    try {
      await fetch(`${process.env.REACT_APP_API_URL}/${API.logCommand}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logData),
      });
    } catch (err) {
      console.error("Failed to log ", err);
    }
  };

  const sendCommand = async (cmdToSend) => {
    if (!selectedMac || !cmdToSend) {
      setStatus("Please select a device and enter a command.");
      return;
    }
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/${API.sendCommand}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: selectedMac, command: cmdToSend }),
      });
      const data = await res.json();
      setStatus(data.message);
    } catch (error) {
      console.error("Command error:", error);
      setStatus("Error sending command");
    }
  };

  const handleFanClick = (level) => {
    const isActive = activeFanBtns.includes(level);
    const command = isActive
      ? `%R0${level}F${getFormattedDateTime()}$`
      : `%R0${level}N${getFormattedDateTime()}$`;

    if (level !== 5) {
      sendToLog(
        `Fan Group ${level} clicked ${isActive ? "off" : "on "}`,
        "",
        command
      );
    } else {
      sendToLog(
        `LOAD Clicked ${isActive ? "off" : "on "}`,
        "",
        command
      );

    }
    sendCommand(command);

    // Update UI immediately (optional, for instant feedback)
    setActiveFanBtns(
      isActive
        ? activeFanBtns.filter((l) => l !== level)
        : [...activeFanBtns, level]
    );
  };

  // New code for Open Lock (using Sweetalert2)
  const handleOpenLock = async () => {
    const { value: password } = await swal.fire({
      title: "Enter Admin password",
      input: "password",
      inputLabel: "Password",
      inputPlaceholder: "Enter admin password",
      showCancelButton: true,
      confirmButtonText: "Open Lock",
      cancelButtonText: "Cancel",
      background: "#292929",
      color: "#fff",
      confirmButtonColor: "#2f2f2fff",
      width: "20em",
    });

    if (password) {
      if (password === ADMIN_PASSWORD) {
        sendCommand(`%L00O${getFormattedDateTime()}$`);
        sendToLog("Password Open Button Clicked");
        setStatus("Lock opened successfully!");
      } else {
        setStatus("Wrong password!");
      }
    }
  };

  const handleResetLock = () => {
    const pwd = window.prompt("Enter admin password to reset lock:");
    if (pwd === ADMIN_PASSWORD) {
      const newLock = window.prompt("Enter new lock value:");

      if (/^\d{9}$/.test(newLock)) {
        if (newLock && newLock.trim() !== "") {
          sendToLog(`Lock Reset ${newLock} clicked`);
          sendCommand(`%L00R${newLock}${getFormattedDateTime()}$$`);
          setStatus(`New password ${newLock} `)
        } else {
          setStatus("New lock value cannot be empty!");
        }
      } else {
        alert("Enter Numeric Password of 9 Digits")
      }
    } else {
      setStatus("Wrong password for resetting lock!");
    }
  };

  // function FlyToLocation({ center }) {
  //   const map = useMap();

  //   useEffect(() => {
  //     if (center) {
  //       map.flyTo(center, map.getZoom(), { duration: 1.2 });
  //     }
  //   }, [center, map]);

  //   return null;
  // }

  // Function: RESETTING PASSWORD ATTEMPT
  const openPassword = () => {
    const pwd = window.prompt("Enter admin password to Open Lock:");
    // const today = new Date();
    if (pwd === ADMIN_PASSWORD) sendCommand(`%L00P${getFormattedDateTime()}$`);
    else setStatus("Wrong password for opening lock!");
  };

  // CENTRALIZED ALARM COMPUTATION FUNCTION
  function alarmComputation(reading, thresholds) {
    if (!reading) return { active: false, alarms: [] };

    const alarms = [];

    if (reading.fireAlarm) alarms.push("Fire ");
    if (reading.waterLeakage) alarms.push("Leakage ");
    if (reading.waterLogging) alarms.push("Logging ");
    if (reading.lockStatus === "OPEN") alarms.push("Lock Open ");
    if (reading.doorStatus === "OPEN") alarms.push("Door Open ");
    if (reading.pwsFailCount === 3) alarms.push("Password Blocked ")

    // threshold-based
    if (reading.insideTemperatureAlarm && (reading.insideTemperature < thresholds.insideTemperature.min)) alarms.push("Low In. Temp. ");
    if (reading.outsideTemperatureAlarm) alarms.push("Out. Temp. ");
    if (reading.inputVoltageAlarm) alarms.push("Inp. Volt. ");
    if (reading.outputVoltageAlarm) alarms.push("Out. Volt. ");
    if (reading.batteryBackupAlarm) alarms.push("Batt. Backup ");
    if (reading.humidityAlarm) alarms.push("Humid. ");


    return {
      active: alarms.length > 0,
      alarms,
    };
  }

  function computeColor(reading, staleThresholdMs) {
    if (!reading?.timestamp) return "disconnected";

    const age = Date.now() - new Date(reading.timestamp).getTime();

    // IF READING NOT RECEIVED FOR MORE THAN STALE SECONDS THAN 'DISCONNECTED'
    if (age > staleThresholdMs) {
      return "disconnected";
    }

    // STATUS ALARMS
    const hasStatusAlarm =
      reading.fireAlarm ||
      reading.waterLeakage ||
      reading.waterLogging ||
      reading.lockStatus === "OPEN" ||
      reading.doorStatus === "OPEN" ||
      [1, 2, 3].includes(reading.password);

    if (hasStatusAlarm) return "status-alarm";

    // GAUGE ALARMS
    const hasGaugeAlarm =
      reading.insideTemperatureAlarm ||
      reading.outsideTemperatureAlarm ||
      reading.humidityAlarm ||
      reading.inputVoltageAlarm ||
      reading.outputVoltageAlarm ||
      reading.batteryBackupAlarm;

    if (hasGaugeAlarm) return "gauge-alarm";

    return "connected";
  }


  // DEVICE STATUS COMPUTATION FOR MAP & DEVICE PANEL
  useEffect(() => {
    // const now = Date.now();
    // STORING CURRENT DEVICES STATUS
    const prevMap = deviceStatusRef.current;
    const nextMap = {};

    let changed = false;


    // const nextStatusMap = {};
    // let hasAnyChange = false;

    for (const device of deviceMeta) {
      const mac = device.mac;
      const reading = latestReadingsByMac[mac];

      // COMPUTING DEVICE STATUS
      const newStatus = computeColor(reading, STALE_THRESHOLD_MS);
      nextMap[mac] = newStatus;

      // CHECKING PREVIOUS AND CURRENT DEVICE STATUS
      if (prevMap[mac] !== newStatus) {
        changed = true;
      }
    }

    // if (changed) {
    //   const prevKeys = Object.keys(prevMap);
    //   const nextKeys = Object.keys(nextMap);
    //   if (prevKeys.length !== nextKeys.length) {
    //     changed = true;
    //   }
    // }

    if (changed) {
      deviceStatusRef.current = nextMap;
      setDeviceStatusMap(nextMap);
    }
  }, [deviceMeta, latestReadingsByMac]);


  // STORING LOGS BASED ON SELECTED MAC 
  useEffect(() => {
    // If no device is selected
    if (!selectedMac) return;

    // Getting reading of selected mac
    const reading = latestReadingsByMac[selectedMac];
    if (!reading) return;

    // Getting alarms for the selectedMac
    const alarmResult = alarmComputation(reading, thresholds);

    if (alarmResult.alarms.length === 0) return;

    // add log entry per 5 seconds (per MAC)
    const now = Date.now();
    const lastAt = lastAlarmLogAtByMacRef.current[selectedMac] || 0;
    if (now - lastAt < LOG_THROTTLE_MS) return;
    lastAlarmLogAtByMacRef.current[selectedMac] = now;

    // Updating logs for selectedMac seperately
    setLogsByMac(prev => {
      const prevLogs = prev[selectedMac] || [];
      const entry = `[${new Date().toLocaleTimeString()}] [${selectedMac}] ${alarmResult.alarms.join("| ")}`;
      const nextLogs = [...prevLogs, entry].slice(-MAX_LOGS_PER_DEVICE);

      return {
        ...prev,
        [selectedMac]: nextLogs
      };
    });

  }, [latestReadingsByMac, selectedMac]);

  // STOPPING LOGS FROM DELETING AT REFRESH
  useEffect(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      saveLogsLocalStorage(logsByMac);
    }, 200);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [logsByMac]);

  // RESETTING LOGS AFTER EVERY 1 HOUR
  useEffect(() => {
    // Reseting Logs after every 1 hour
    const logTimer = setInterval(() => {
      lastResetAtRef.current = Date.now();
      setLogsByMac({});
      // keep persisted value in sync with in-memory reset
      try {
        window?.localStorage?.setItem(
          LOG_STORAGE_KEY,
          JSON.stringify({ lastResetAt: lastResetAtRef.current, logsByMac: {} })
        );
      } catch {
        // ignore
      }
    }, LOG_RESET_MS);

    // Stops timer after resetting log =
    return () => clearInterval(logTimer);
  }, []);

  // LOGS AUTO SCROLL
  useEffect(() => {
    if (!autoScroll) return;

    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [currentLogs, autoScroll]);

  // LOGS SCROLLING FUNCTION
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const currentScrollTop = el.scrollTop;

    // user scrolled UP → lock auto-scroll OFF
    if (currentScrollTop < lastScrollTopRef.current) {
      setAutoScroll(false);
    }

    // user scrolled to bottom → re-enable
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;

    if (distanceFromBottom <= 2) {
      setAutoScroll(true);
    }
    lastScrollTopRef.current = currentScrollTop;

  }


  // const toggleFullscreen = () => {
  //   const iframe = document.querySelector(".camera-iframe");
  //   if (iframe.requestFullscreen) iframe.requestFullscreen();
  //   else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
  //   else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();
  // };

  // const zoomIn = () => setZoom((prev) => Math.min(prev + 0.1, 2));
  // const zoomOut = () => setZoom((prev) => Math.max(prev - 0.1, 1));
  // const rotateFeed = () => setRotation((prev) => (prev + 90) % 360);

  // const isAlarmActive = (reading) =>
  //   reading.fireAlarm || reading.waterLeakage || reading.waterLogging || reading.lockStatus === "OPEN" || reading.doorStatus === "OPEN" || [1, 2, 3].includes(reading.password);


  // const CHART_DELAY_MS = 2 * 60 * 1000; // 2 minutes
  // const chartCutoffTime = Date.now() - CHART_DELAY_MS;
  // const historicalData = readings

  //   .filter((r) => r.mac === selectedMac && r.timestamp)
  //   .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) // oldest to latest
  //   .slice(-15)
  //   .map((r) => {
  //     const d = new Date(r.timestamp);

  //     return {
  //       time:
  //         `${d.getHours().toString().padStart(2, "0")}:` +
  //         `${d.getMinutes().toString().padStart(2, "0")}:` +
  //         `${d.getSeconds().toString().padStart(2, "0")}.` +
  //         `${d.getMilliseconds().toString().padStart(3, "0")}`, // tenths of a second,
  //       insideTemperature: Number(r.insideTemperature.toFixed(2)),
  //       outsideTemperature: Number(r.outsideTemperature.toFixed(2)),
  //       humidity: Number(r.humidity.toFixed(2)),
  //       inputVoltage: Number(r.inputVoltage.toFixed(2)),
  //       outputVoltage: Number(r.outputVoltage.toFixed(2)),
  //       batteryBackup: Number(r.batteryBackup.toFixed(2)),
  //     }
  //   });

  // UPDATED FOR TIMING ISSUE TESTING
  // const historicalData = useMemo(() => {
  //   return readings
  //     .filter(r =>
  //       r.mac === selectedMac &&
  //       r.timestamp &&
  //       new Date(r.timestamp).getTime() <= chartCutoffTime
  //     )
  //     .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  //     .slice(-15);
  // }, [readings, selectedMac, chartCutoffTime]);


  const fetchSnapshots = async (selectedMac) => {
    try {
      // setActiveTab("snapshots");
      if (selectedMac) {
        let response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/snapshots/?mac=${selectedMac}`
        );
        const snapshotFiles = await response.json();
        setSnapshots(snapshotFiles);
      } else {
        setSnapshots([]);
      }
    } catch (err) {
      console.error("Error fetching snapshots:", err);
    }
  };


  // Fetch snapshots on component mount
  useEffect(() => {
    fetchSnapshots(selectedMac);

    const snapshotInterval = setInterval(() => {
      fetchSnapshots(selectedMac);
    }, 240000); // ✅ Set up timer

    return () => clearInterval(snapshotInterval); // ✅ Cleanup
  }, [selectedMac]);

  // Realtime notification when a snapshot is captured (server-sent events)
  useEffect(() => {
    const baseUrl = process.env.REACT_APP_API_URL;
    if (!baseUrl) return;

    const es = new EventSource(`${baseUrl}/api/events/snapshots`);

    const onSnapshot = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        const mac = payload?.mac;
        if (!mac) return;

        swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: `Snapshot captured IP: ${mac}`,
          // text: `MAC: ${mac}`,
          timer: 10000,
          timerProgressBar: true,
          showConfirmButton: false,
          showCloseButton: true,
          backdrop: false,
          width: 300,
          height: 100
        });

        // If user is viewing the same device, refresh the snapshot list
        if (String(selectedMacRef.current).toLowerCase() === String(mac).toLowerCase()) {
          fetchSnapshots(selectedMacRef.current);
        }
      } catch {
        // ignore malformed payload
      }
    };

    es.addEventListener("snapshot", onSnapshot);

    // cleanup
    return () => {
      try {
        es.removeEventListener("snapshot", onSnapshot);
        es.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const filteredDevices = useMemo(() => {
    let list = deviceMeta;

    // Status filter
    if (statusFilter !== "all") {
      list = list.filter(device => {
        const status = deviceStatusMap[device.mac] || "disconnected";
        return status === statusFilter;
      });
    }

    // Search filter
    if (searchTerm.trim() !== "") {
      const lower = searchTerm.toLowerCase();

      list = list.filter(device =>
        device.locationId?.toLowerCase().includes(lower) ||
        device.mac?.toLowerCase().includes(lower)
      );
    }

    return list;
  }, [deviceMeta, deviceStatusMap, statusFilter, searchTerm]);

  const alarmKeys = ALARM_KEYS;

  const statusKeys = STATUS_KEYS

  const hupsKeys = HUPS_KEYS

  return (
    <>
      {/* Logo */}
      {/* <div className="logo-panel">

        <div className="logo-bar">
          <div className="logo-group logo-group--left">
            <img className="logo-img" src="/bharatnet_logo.png" alt="BharatNet" />
            <img className="logo-img" src="/BSNL_logo.png" alt="BSNL" />
          </div>
          <div className="logo-group logo-group--right">
            <img className="logo-img" src="/ITI.png" alt="ITI" />
            <img className="logo-img" src="/technotrendz.png" alt="Technotrendz Logo" />
          </div>
        </div>
      </div> */}

      {/* Dashboard */}
      <div className="dashboard">
        <div className="panel">
          <div className="rack-header">
            <h2 className="selected-heading">
              📟 Selected Rack: {selectedMac && <span> {selectedDevice}</span>}
            </h2>
            {/* ALARM TOGGLE */}
            <div className="alarm-container">
              <span>Alarm</span>
              <label className="switch">
                <input type="checkbox" checked={alarmToggle}
                  onChange={(e) => setAlarmToggle(e.target.checked)} />
                <span className="slider"></span>
              </label>
            </div>
          </div>
          {latestReading && (
            <div className="panel-content-scroll">
              <div className="tabs">
                <button
                  className={activeTab === "gauges" ? "active" : ""}
                  onClick={() => setActiveTab("gauges")}
                >
                  Gauges
                </button>
                <button
                  className={activeTab === "status" ? "active" : ""}
                  onClick={() => setActiveTab("status")}
                >
                  Status
                </button>
                <button
                  className={activeTab === "snapshots" ? "active" : ""}
                  onClick={() => { setActiveTab("snapshots"); fetchSnapshots(selectedMac); }}
                >
                  Snapshots
                </button>
              </div>

              {/* GAUGES TAB */}
              {activeTab === "gauges" && (
                <div className="gauges grid-3x3">
                  <Gauge
                    label="Inside Temp"
                    value={(latestReading.insideTemperature).toFixed(2)}
                    max={100}
                    color={latestReading.insideTemperature < thresholds.insideTemperature.min ? "#ec7632" : latestReading.insideTemperature >= thresholds.insideTemperature.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.insideTemperatureAlarm : false}
                  />
                  <Gauge
                    label="Outside Temp"
                    value={(latestReading.outsideTemperature).toFixed(2)}
                    max={100}
                    color={latestReading.outsideTemperature < thresholds.outsideTemperature.min ? "#ec7632" : latestReading.outsideTemperature >= thresholds.outsideTemperature.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.outsideTemperatureAlarm : false}
                  />
                  <Gauge
                    label="Humidity"
                    value={latestReading.humidity}
                    max={100}
                    color={latestReading.humidity < thresholds.humidity.min ? "#ec7632" : latestReading.humidity >= thresholds.humidity.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.humidityAlarm : false}
                  />
                  <Gauge
                    label="Input Volt"
                    value={(latestReading.inputVoltage).toFixed(2)}
                    max={100}
                    color={latestReading.inputVoltage < thresholds.inputVoltage.min ? "#ec7632" : latestReading.inputVoltage >= thresholds.inputVoltage.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.inputVoltageAlarm : false}
                  />
                  <Gauge
                    label="Output Volt"
                    value={(latestReading.outputVoltage).toFixed(2)}
                    max={100}
                    color={latestReading.outputVoltage < thresholds.outputVoltage.min ? "#ec7632" : latestReading.outputVoltage >= thresholds.outputVoltage.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.outputVoltageAlarm : false}
                  />
                  <Gauge
                    label="DV Current"
                    value={(latestReading.inputVoltage).toFixed(2)}
                    max={45}
                    color={latestReading.inputVoltage < thresholds.inputVoltage.min ? "#ec7632" : latestReading.inputVoltage >= thresholds.inputVoltage.max ? "#fb1616" : "#67b816"}
                    alarm={alarmToggle ? latestReading.inputVoltageAlarm : false}
                  />
                  <Gauge
                    label="Battery %"
                    value={(latestReading.batteryBackup * 1.5).toFixed(2)}
                    max={120}
                    color={latestReading.batteryBackup <= thresholds.batteryBackup.min ? "#ec7632" : "#67b816"}
                    alarm={alarmToggle ? latestReading.batteryBackupAlarm : false}
                  />
                  <Gauge
                    label="Battery(Hours)"
                    value={(latestReading.batteryBackup).toFixed(2)}
                    max={120}
                    color={latestReading.batteryBackup <= thresholds.batteryBackup.min ? "#ec7632" : "#67b816"}
                    alarm={alarmToggle ? latestReading.batteryBackupAlarm : false}
                  />
                  {latestReading.batteryBackup <= 10 ?
                    <Gauge
                      label="LockBat(Left..)"
                      value={0}
                      max={12}
                      color={latestReading.batteryBackup <= thresholds.batteryBackup.min ? "#ec7632" : "#67b816"}
                      alarm={alarmToggle ? latestReading.batteryBackupAlarm : false}
                    /> :
                    <Gauge
                      label="LockBat(Left..)"
                      value={Math.floor(((latestReading.batteryBackup - 9) * 4))}
                      // value={6}
                      max={12}
                      color={latestReading.batteryBackup <= thresholds.batteryBackup.min ? "#ec7632" : "#67b816"}
                      hoverTitle={"LockBat Left Hours"}
                      alarm={alarmToggle ? latestReading.batteryBackupAlarm : false}
                    />
                  }
                </div>
              )}

              {/* STATUS TAB */}
              {activeTab === "status" && (
                <div className="fan-status">
                  <div className="fan-status-line">
                    <h4>Fan Running Status</h4>
                    {[...Array(6)].map((_, i) => {
                      const statusVal = latestReading[`fan${i + 1}Status`]; // 0=off, 1=healthy, 2=faulty
                      // console.log('statusVal', statusVal);

                      // console.log("statusC");
                      let statusClass = "off";
                      if (statusVal === 1) {
                        statusClass = "running"; // green
                      } else if (statusVal === 2) {
                        statusClass = "faulty"; // red
                      }
                      // console.log(statusClass);

                      return (
                        <div key={i} className="fan-light">
                          <div className={`fan-light-circle ${statusClass}`} />
                          <div className="fan-label">F{i + 1}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="alarm-line">
                    <h4>Alarms</h4>
                    {alarmKeys.map((alarm, i) => (
                      <div key={i} className="alarm-indicator">
                        <div
                          className={`alarm-led ${(
                            alarm.key === "fireAlarm" &&
                              latestReading.doorStatus === "CLOSED" &&
                              latestReading.insideTemperature >= 48 &&
                              latestReading.insideTemperature < 70
                              ? ""
                              : latestReading[alarm.key] === 87
                                ? "wait"
                                : latestReading[alarm.key]
                                  ? "active"
                                  : ""
                          )}`}
                        />
                        <div className="alarm-label">{alarm.Name}</div>
                      </div>
                    ))}
                    {statusKeys.map((status, i) => {
                      if (status.key !== "pwsFailCount") {
                        return (
                          <div key={i} className="alarm-indicator">
                            <div
                              className={`alarm-led ${latestReading[status.key] === "OPEN"
                                ? "active"
                                : ""
                                }`}
                            />
                            <div className="alarm-label">{status.Name}</div>
                          </div>
                        );
                      } else {
                        return (
                          <>
                            <div key={i} className="alarm-indicator">
                              {/* <div className={`alarm-led ${latestReading[status.key] === 1 ? 'active' : ''}`} /> */}
                              <div
                                className={`alarm-led 
                            ${latestReading[status.key] === 1
                                    ? "danger"
                                    : latestReading[status.key] === 2
                                      ? "warn"
                                      : latestReading[status.key] === 3
                                        ? "active"
                                        : ""
                                  }`}
                              />
                              <div className="alarm-label">{status.Name}</div>
                              <div className="alarm-attempt">{3 - latestReading[status.key]} Attempt Left</div>
                            </div>
                          </>
                        );
                      }
                    })}
                  </div>

                  <div className="alarm-line">
                    <h4>HUPS</h4>
                    {hupsKeys.map((hups, i) => (
                      <div key={i} className="alarm-indicator">
                        <div
                          className={`alarm-led ${latestReading[hups.key] ? "active" : ""
                            }`}
                        />
                        <div className="alarm-label">
                          {hups.Name}
                        </div>
                      </div>
                    ))}
                    {/* {["O.Load", "MPT", "MOSFET"].map((key, i) => (
                      <div key={i} className="alarm-indicator">
                        <div
                          className={`alarm-led ${latestReading[key] === "OPEN" ? "active" : ""
                            }`}
                        />
                        <div className="alarm-label">
                          {key.replace("Status", "")}
                        </div>
                      </div>
                    ))} */}
                  </div>

                  <h4>🛠 Commands</h4>
                  <div className="fan-power-buttons aligned">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div key={level} className="fan-light">
                        <button
                          className={`power-btn ${activeFanBtns.includes(level) ||
                            (latestReading &&
                              latestReading[`fanLevel${level}Running`] === true)
                            ? "active"
                            : ""
                            }`}
                          onClick={() => handleFanClick(level)}
                        />
                        <div className="fan-label">
                          {level >= 1 && level <= 4 ? `FG ${level}` : "NON-CRITICAL LOAD"}
                        </div>
                      </div>
                    ))}
                    <div className="fan-light">
                      <button className="lock-btn" onClick={handleOpenLock}>
                        🔓
                      </button>
                      <div className="fan-label">Lock</div>
                    </div>
                    <div className="fan-light">
                      <button className="lock-btn" onClick={handleResetLock}>
                        🔐
                      </button>
                      <div className="fan-label">Reset</div>
                    </div>
                    <div className="fan-light">
                      <button className="lock-btn" onClick={openPassword}>
                        🔐
                      </button>
                      <div className="fan-label">Open PWD</div>
                    </div>
                  </div>
                  <span>SysId: {selectedMac.slice(8)}</span>
                  {status && <p>{status}</p>}
                </div>
              )}


              {/* Full Screen Image Modal with Navigation */}
              {selectedImage && (
                <div
                  className="fullscreen-modal"
                  onClick={() => setSelectedImage(null)}
                >
                  <div className="modal-header">
                    <button
                      className="close-btn-fullscreen"
                      onClick={() => setSelectedImage(null)}
                    >
                      ✕
                    </button>
                    <div className="image-title">
                      {selectedImage.split("/").pop()} (
                      {snapshots.findIndex(
                        (img) =>
                          `${process.env.REACT_APP_API_URL}/api/snapshots/${img}` ===
                          selectedImage
                      ) + 1}{" "}
                      of {snapshots.length})
                    </div>
                  </div>

                  {/* Navigation Arrows */}
                  {snapshots.length > 1 && (
                    <>
                      <button
                        className="nav-arrow left-arrow"
                        onClick={(e) => {
                          e.stopPropagation();
                          const currentIndex = snapshots.findIndex(
                            (img) =>
                              `${process.env.REACT_APP_API_URL}/api/snapshots/${img}` ===
                              selectedImage
                          );
                          const prevIndex =
                            (currentIndex - 1 + snapshots.length) %
                            snapshots.length;
                          setSelectedImage(
                            `${process.env.REACT_APP_API_URL}/api/snapshots/${snapshots[prevIndex]}`
                          );
                        }}
                      >
                        ‹
                      </button>
                      <button
                        className="nav-arrow right-arrow"
                        onClick={(e) => {
                          e.stopPropagation();
                          const currentIndex = snapshots.findIndex(
                            (img) =>
                              `${process.env.REACT_APP_API_URL}/api/snapshots/${img}` ===
                              selectedImage
                          );
                          const nextIndex =
                            (currentIndex + 1) % snapshots.length;
                          setSelectedImage(
                            `${process.env.REACT_APP_API_URL}/api/snapshots/${snapshots[nextIndex]}`
                          );
                        }}
                      >
                        ›
                      </button>
                    </>
                  )}

                  <div className="modal-body">
                    <img
                      src={selectedImage}
                      alt="Enlarged view"
                      className="fullscreen-image"
                    />
                  </div>
                </div>
              )}

              {/* Snapshots */}
              {activeTab === "snapshots" && (
                <div className="camera-tab">
                  <h4>🖼️ Snapshots</h4>
                  <div className="snapshots-grid">
                    {snapshots.length > 0 ? (
                      snapshots.map((filename, i) => (
                        <div
                          key={i}
                          className="snapshot-item"
                          onClick={() =>
                            setSelectedImage(
                              `${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`
                            )
                          }
                        >
                          <img
                            key={i}
                            src={`${process.env.REACT_APP_API_URL}/api/snapshots/${filename}?mac=${selectedMac}`}
                            alt={`snapshot-${i + 1}`}
                            onError={(e) => {
                              e.target.src =
                                "https://via.placeholder.com/120x90?text=Error";
                            }}
                          />
                          <div className="snapshot-label">{filename.slice(0, 23)}</div>
                        </div>
                      ))
                    ) : (
                      <p>No snapshots available</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel 2: LOGS */}
        <div className="panel">
          <h2>📈 Live Logs</h2>
          {/* {selectedMac && historicalData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 10, fill: "#ccc" }}
                />
                <YAxis />
                <Tooltip />0
                <Legend />
                <Line
                  type="monotone"
                  dataKey="insideTemperature"
                  stroke="#ff4d4f"
                  dot={false}
                  isAnimationActive={true}
                  name="insideTemp"
                />
                <Line
                  type="monotone"
                  dataKey="humidity"
                  stroke="#1d3557"
                  dot={false}
                  isAnimationActive={true}
                />
                <Line
                  type="monotone"
                  dataKey="inputVoltage"
                  stroke="#00b894"
                  dot={false}
                  isAnimationActive={true}
                  name="I/P volt"
                />
                <Line
                  type="monotone"
                  dataKey="outputVoltage"
                  stroke="#0984e3"
                  dot={false}
                  isAnimationActive={true}
                  name="O/P volt"
                />
                <Line
                  type="monotone"
                  dataKey="batteryBackup"
                  stroke="#2205ffff"
                  dot={false}
                  isAnimationActive={true}
                  name="Battery"
                />
                <Line
                  type="monotone"
                  dataKey="outsideTemperature"
                  stroke="#0b6517ff"
                  dot={false}
                  isAnimationActive={true}
                  name="outsideTemp"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p>Select a device to see its historical chart</p>
          )} */}


          {/* LOG SECTION */}
          <div className="w-full h-64 overflow-y-auto bg-black border rounded-md log-scroll"
            onScroll={handleScroll}
          >
            {/* <div
              className="p-3 "
            > */}
            <div className="log-panel">
              {Object.keys(logsByMac).length === 0 ? (
                <p>No logs in last 1 hour</p>
              ) : (
                currentLogs.map((line, i) => (
                  <pre key={i} className="log-line">{line}</pre>
                ))
              )}
            </div>

            <div ref={bottomRef} />
            {/* </div> */}
          </div>

        </div>

        {/* Panel 3: Device Tiles */}
        {/* <div className="panel device-list">
          <h2>
            🟢 Devices:
            <span style={{ fontWeight: "lighter", fontSize: "20px", marginLeft: "10px" }}>(Connected: {connectedDeviceCount}/{deviceMeta.length})</span>
          </h2>
          <div className="grid">

            {/* {(() => {
              const latestReadingsByMac = {};
              readings.forEach((r) => {
                const existing = latestReadingsByMac[r.mac];
                if (
                  !existing ||
                  new Date(r.timestamp) > new Date(existing.timestamp)
                ) {
                  latestReadingsByMac[r.mac] = r;
                }
              });

              return deviceMeta.map((device) => {
                console.count("dashboard render")
                const { mac } = device;
                const reading = latestReadingsByMac[mac];
                let colorClass = "disconnected"; // default

                if (reading && reading.timestamp) {
                  const age =
                    Date.now() - new Date(reading.timestamp).getTime();
                  const staleThreshold = 30000; // 30 seconds

                  if (age <= staleThreshold) {
                    // Use status from latest valid reading
                    const hasStatusAlarm = isAlarmActive(reading);
                    const hasGaugeAlarm =
                      reading.insideTemperatureAlarm ||
                      reading.outsideTemperatureAlarm ||
                      reading.humidityAlarm ||
                      reading.inputVoltageAlarm ||
                      reading.outputVoltageAlarm ||
                      reading.batteryBackupAlarm;

                    colorClass = hasStatusAlarm
                      ? "status-alarm"
                      : hasGaugeAlarm
                        ? "gauge-alarm"
                        : "connected";
                  } else {
                    // Reading is stale — treat as disconnected
                    colorClass = "disconnected";
                  }
                }

                return (
                  <div
                    key={mac}
                    className={`device-tile ${colorClass} ${selectedMac === mac ? "selected" : ""
                      }`}
                    onClick={() => { setSelectedMac(mac); setSelectedDevice(device.locationId) }}
                  >
                    {device.locationId || mac}
                  </div>
                );
              });
            })()}


         {deviceMeta.map((device) => {
              console.count("dashboard render");

              const { mac } = device;
              const colorClass = deviceStatusMap[mac] || "disconnected";

              // const reading = latestReadingsByMac[mac];
              // let colorClass = deviceStatusMap[mac] || "disconnected";

              // if (reading?.timestamp) {
              //   const age = Date.now() - new Date(reading.timestamp).getTime();

              //   if (age <= STALE_THRESHOLD_MS) {
              //     const hasStatusAlarm = isAlarmActive(reading);

              //     const hasGaugeAlarm =
              //       reading.insideTemperatureAlarm ||
              //       reading.outsideTemperatureAlarm ||
              //       reading.humidityAlarm ||
              //       reading.inputVoltageAlarm ||
              //       reading.outputVoltageAlarm ||
              //       reading.batteryBackupAlarm;

              //     colorClass = hasStatusAlarm
              //       ? "status-alarm"
              //       : hasGaugeAlarm
              //         ? "gauge-alarm"
              //         : "connected";
              //   }
              // }

              return (
                <div
                  key={mac}
                  className={`device-tile ${colorClass} ${selectedMac === mac ? "selected" : ""
                    }`}
                  onClick={() => {
                    setSelectedMac(mac);
                    setSelectedDevice(device.locationId);
                  }}
                >
                  {device.locationId || mac}
                </div>
              );
            })}

          </div>
        </div> */}
        <div className="panel device-list">
          <DevicePanel
            deviceMeta={deviceMeta}
            deviceStatusMap={deviceStatusMap}
            selectedMac={selectedMac}
            onSelectDevice={handleSelectDevice}
            connectedCount={connectedDeviceCount}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredDevices={filteredDevices}
            loading={loadingDevices}
          />
        </div>


        {/* Panel 4: Map */}
        {/* <div className="panel device-map">
          <h2>🗺️ Device Map</h2>

          {(() => {
            const selectedDevice = deviceMeta.find(
              (d) => d.mac === selectedMac
            );
            const lat = parseFloat(selectedDevice?.latitude);
            const lon = parseFloat(selectedDevice?.longitude);
            const selectedCenter =
              !isNaN(lat) && !isNaN(lon) ? [lat, lon] : defaultLocation;

            return (
              <MapContainer
                // key={selectedMac || "default-map"}
                key="device-map"
                center={selectedCenter}
                zoom={50}
                scrollWheelZoom={true}
                style={{ height: "315px", width: "100%" }}
                whenCreated={handleMapCreated}
              >
                <TileLayer
                  url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>'
                />

                <FlyToLocation center={selectedCenter} />

                {deviceMeta.map((device) => {
                  const { mac } = device;
                  const reading = latestReadingsByMac[mac];

                  let dotClass = "disconnected"; // Default state

                  if (reading) {
                    const timeDiff =
                      Date.now() - new Date(reading.timestamp).getTime();
                    const isStale = timeDiff > 30000;

                    if (!isStale) {
                      const hasStatusAlarm = isAlarmActive(reading);
                      const hasGaugeAlarm =
                        reading.insideTemperatureAlarm ||
                        reading.outsideTemperatureAlarm ||
                        reading.humidityAlarm ||
                        reading.inputVoltageAlarm ||
                        reading.outputVoltageAlarm ||
                        reading.batteryBackupAlarm;

                      dotClass = hasStatusAlarm
                        ? "status-alarm"
                        : hasGaugeAlarm
                          ? "gauge-alarm"
                          : "connected";
                    }
                  }

                  const icon = L.divIcon({
                    className: "custom-marker",
                    html: `<div class="marker-dot ${dotClass}"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10],
                  });

                  const lat = parseFloat(device.latitude);
                  const lon = parseFloat(device.longitude);
                  if (isNaN(lat) || isNaN(lon)) return null;

                  return (
                    <Marker
                      key={mac}
                      position={[lat, lon]}
                      icon={icon}
                      ref={(ref) => {
                        markerRefs.current[mac] = ref;
                      }}
                      eventHandlers={{
                        mouseover: (e) => {
                          e.target.openPopup();
                        },
                        mouseout: (e) => {
                          e.target.closePopup();
                        },
                        click: () => setSelectedMac(mac),
                      }}
                    >
                      <Popup>
                        {device.locationId || mac}
                        <br />
                        {device.address || ""}
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            );
          })()}

          <div
            style={{
              marginTop: "8px",
              fontSize: "0.8rem",
              color: "#aaa",
              textAlign: "right",
            }}
          >
            Best viewed on{" "}
            {navigator.userAgent.includes("Chrome")
              ? "Chrome"
              : navigator.userAgent.includes("Firefox")
                ? "Firefox"
                : "your browser"}{" "}
            @ {window.innerWidth}x{window.innerHeight}
          </div>
        </div> */}
        <div className="panel device-map">
          <DeviceMap
            deviceMeta={deviceMeta}
            deviceStatusMap={deviceStatusMap}
            selectedMac={selectedMac}
            onMarkerClick={setSelectedMac}
          />
        </div>
      </div >
    </>
  );
}

function Gauge({ label, value, max, color, alarm = false, hoverTitle }) {

  return (
    <div className={`gauge-box small ${alarm ? "alarm" : ""}`}>
      <CircularProgressbar
        value={value}
        maxValue={max}
        text={`${value}`}
        styles={buildStyles({
          pathColor: color,
          textColor: "#fff",
          trailColor: "#333",
        })}
      />
      <div
        className="gauge-label"
        style={hoverTitle ? { cursor: "pointer" } : {}}
        title={hoverTitle}
      >
        {label}
      </div>
    </div>
  );
}

export default DashboardView;
