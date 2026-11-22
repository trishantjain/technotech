import React, { useEffect, useState, useRef, useCallback } from "react";
import "../App.css";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import "leaflet/dist/leaflet.css";
import swal from "sweetalert2";
import { useMemo } from "react";
import thresholds from "../config/thresholds";
import DeviceMap from "../components/DeviceMap";
import DevicePanel from "../components/DevicePanel";
import {
  ADMIN_PASSWORD,
  ALARM_KEYS,
  HUPS_KEYS,
  LOG_CONSTANTS,
  STATUS_KEYS,
} from "../config/constants.js";
import { getFormattedDateTime } from "../utils/date.js";
import { API } from "../config/api.js";
import PasswordPrompt from "../components/PasswordPrompt.jsx";
import { useNavigate } from "react-router-dom";

const STALE_THRESHOLD_MS = 30000; // 30 seconds
const LIVE_LOG_LIMIT = 800;
const OLD_READINGS_FETCH_INTERVAL = 5000;
const DEVICE_STATUS_FETCH_INTERVAL = 5000;
const READINGS_FETCH_INTERVAL = 5000;
const SNAPSHOT_FETCH_INTERVAL = 240000;

const LOG_STORAGE_KEY = "tt.logsByMac.v1";
const { LOG_RESET_MS, MAX_LOGS_PER_DEVICE } = LOG_CONSTANTS; // 1 hour
// const { LOG_RESET_MS, MAX_LOGS_PER_DEVICE, LOG_THROTTLE_MS } = LOG_CONSTANTS; // 1 hour
// const {  } = CONSTANTS;
// const LOG_THROTTLE_MS = 5000; // log at most once per 5 seconds per device
const EMPTY_LOGS = [];

const USE_NEW_READING_LOGIC = true;

const PAPI = "/api";
// const PAPI = "/api/";

function DashboardView() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");

  // NEW: Latest reading of the currently selected device
  const [readings, setReadings] = useState([]);
  const [selectedReading, setSelectedReading] = useState(null);

  // eslint-disable-next-line
  const [devices, setDevices] = useState([]);
  const [deviceMeta, setDeviceMeta] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState("gauges");
  const [activeFanBtns, setActiveFanBtns] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState("");

  const [dashboardMode, setDashboardMode] = useState("monitoring");

  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [showOpenPasswordPrompt, setShowOpenPasswordPrompt] = useState(false);
  const [deviceStatusMap, setDeviceStatusMap] = useState({});

  const [rackTimer, setRackTimer] = useState(0);
  const [logTimer, setLogTimer] = useState(0);

  const [autoScroll, setAutoScroll] = useState(true);
  const [alarmToggle, setAlarmToggle] = useState(false);

  // const deviceStatusRef = useRef({});
  const selectedMacRef = useRef("");

  // NEW: Prevent duplicate live logs
  const lastLoggedReadingRef = useRef({});
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    selectedMacRef.current = selectedMac;
  }, [selectedMac]);

  // LOGS
  const lastResetAtRef = useRef(Date.now());
  const lastAlarmLogAtByMacRef = useRef({});
  const latestReadingsByMacRef = useRef({});
  const mapRef = useRef(null);
  // const isFetchingRef = useRef(false); // TIMING TESTING

  // const _viewportRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const bottomRef = useRef(null);
  const persistTimerRef = useRef(null);
  const prevReadingsRef = useRef([]);

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

      // Logs by ip
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
        }),
      );
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  };

  const [logsByMac, setLogsByMac] = useState(() =>
    USE_NEW_READING_LOGIC ? {} : readLogsLocalStorage(),
  );

  // STORING LOG OF SELECTED DEVICE
  const currentLogs = useMemo(
    () => logsByMac[selectedMac] || EMPTY_LOGS,
    [logsByMac, selectedMac],
  );

  //Map and marker refs
  // const markerRefs = useRef({});

  // const latestReadingsByMac = {};
  // readings.forEach((r) => {
  //   const existing = latestReadingsByMac[r.ip];
  //   if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
  //     latestReadingsByMac[r.ip] = r;
  //   }
  // });

  // In this code 'latestReadingsByMac' this only computed only when readings change
  const latestReadingsByMac = useMemo(() => {
    const map = {};

    for (const r of readings) {
      const existing = map[r.ip];

      if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
        map[r.ip] = r;
      }
    }
    return map;
  }, [readings]);

  const connectedDeviceCount = useMemo(() => {
    let connected = 0;
    let statusAlarm = 0;
    let gaugeAlarm = 0;
    let disconnected = 0;

    // let count = 0;
    for (const ip in deviceStatusMap) {
      const status = deviceStatusMap[ip];

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
      total: deviceMeta.length,
    };
  }, [deviceStatusMap, deviceMeta.length]);

  // const frontendAlarmsByMac = useMemo(() => {
  //   const map = {};
  //   for (const ip in latestReadingsByMac) {
  //     map[ip] = alarmComputation(
  //       latestReadingsByMac[ip],
  //       thresholds
  //     );
  //   }
  //   return map;
  // }, [latestReadingsByMac]);

  // const selectedDeviceMeta = deviceMeta.find((d) => d.ip === selectedMac);
  // const latestReading = readings.find((r) => r.ip === selectedMac);
  const latestReading = USE_NEW_READING_LOGIC
    ? selectedReading
    : latestReadingsByMac[selectedMac];

  // FETCHING DATA EVERY 5 SECONDS
  // useEffect(() => {
  //   const interval = setInterval(fetchData, 5000);

  //   fetchData();

  //   return () => {
  //     clearInterval(interval);
  //   };
  // }, []);

  // LEGACY READINGS API - FALLBACK ONLY
  useEffect(() => {
    if (USE_NEW_READING_LOGIC) return;

    let isFetching = false;

    const fetchLegacyReadings = async () => {
      if (isFetching) return;

      isFetching = true;

      try {
        const response = await fetch(`${PAPI}/${API.readings}`);

        if (!response.ok) return;

        let readingsData = await response.json();

        readingsData = Array.isArray(readingsData) ? readingsData : [];

        const isSame =
          prevReadingsRef.current.length === readingsData.length &&
          readingsData.every((reading) => {
            const previous = prevReadingsRef.current.find(
              (item) => item.ip === reading.ip,
            );

            return previous && previous.timestamp === reading.timestamp;
          });

        if (isSame) return;

        setReadings(readingsData);
        setRackTimer(0);

        prevReadingsRef.current = readingsData;

        const ip = selectedMacRef.current;

        if (ip) {
          const reading = readingsData.find((item) => item.ip === ip);

          if (reading) {
            const alarmResult = alarmComputation(reading, thresholds);

            const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join("| ")}`;

            setLogsByMac((prev) => {
              const previousLogs = prev[ip] || [];

              return {
                ...prev,
                [ip]: [...previousLogs, entry].slice(-MAX_LOGS_PER_DEVICE),
              };
            });

            setLogTimer(0);
          }
        }
      } catch (error) {
        console.error("Legacy readings error:", error);
      } finally {
        isFetching = false;
      }
    };

    fetchLegacyReadings();

    const interval = setInterval(
      fetchLegacyReadings,
      OLD_READINGS_FETCH_INTERVAL,
    );

    return () => clearInterval(interval);
  }, []);

  // FETCH DEVICE METADATA ON COMPONENT MOUNT
  useEffect(() => {
    const controller = new AbortController();

    const fetchDeviceMetadata = async () => {
      try {
        const response = await fetch(`${PAPI}/${API.deviceInfo}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Device metadata API failed: ${response.status}`);
        }

        const metadata = await response.json();

        setDeviceMeta(Array.isArray(metadata) ? metadata : []);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Device metadata error:", error);
        }
      } finally {
        if (!controller.signal.aborted && !hasLoadedOnceRef.current) {
          setLoadingDevices(false);
          hasLoadedOnceRef.current = true;
        }
      }
    };

    fetchDeviceMetadata();

    return () => controller.abort();
  }, []);

  // FETCH DEVICE STATUS EVERY 5 SECONDS
  useEffect(() => {
    let isFetching = false;
    let isActive = true;

    const fetchDeviceStatus = async () => {
      if (isFetching || !isActive) return;

      isFetching = true;

      try {
        const response = await fetch(`${PAPI}/${API.deviceStatus}`);

        if (!response.ok) {
          throw new Error(`Device status API failed: ${response.status}`);
        }

        const statusPayload = await response.json();
        const statusDevices = statusPayload?.data?.devices;

        if (statusPayload?.success === true && Array.isArray(statusDevices)) {
          const nextStatusMap = {};

          for (const device of statusDevices) {
            const ip = String(device.ip || "").trim();

            if (!ip) continue;

            nextStatusMap[ip] = device.dashboardStatus || "disconnected";
          }

          if (isActive) {
            setDeviceStatusMap(nextStatusMap);
          }
        } else {
          console.error("Invalid device status API response:", statusPayload);
        }
      } catch (error) {
        if (isActive) {
          console.error("Device status error:", error);
        }
      } finally {
        isFetching = false;
      }
    };

    fetchDeviceStatus();

    const interval = setInterval(
      fetchDeviceStatus,
      DEVICE_STATUS_FETCH_INTERVAL,
    );

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

  // NEW: FETCH ONLY THE SELECTED DEVICE'S LATEST READING
  useEffect(() => {
    if (!USE_NEW_READING_LOGIC) return;

    if (!selectedMac) {
      setSelectedReading(null);
      return;
    }

    setSelectedReading(null);

    const controller = new AbortController();
    let isFetching = false;

    const fetchSelectedReading = async () => {
      if (isFetching) return;

      isFetching = true;

      try {
        const ip = String(selectedMac).trim();

        const response = await fetch(
          `${PAPI}/device/${encodeURIComponent(ip)}`,
          { signal: controller.signal },
        );

        if (response.status === 404) {
          setSelectedReading(null);
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch reading for ${ip}: ${response.status}`,
          );
        }

        const readingData = await response.json();

        // Validate that the response belongs to the selected device
        if (
          String(readingData?.ip || "")
            .trim()
            .toLowerCase() !== ip.toLowerCase()
        ) {
          return;
        }

        setSelectedReading(readingData);

        // Use MongoDB ID where available; otherwise use timestamp
        const readingKey = String(
          readingData._id || readingData.timestamp || "",
        );

        // Do not generate duplicate logs for the same reading
        if (!readingKey) {
          console.warn("Reading has no ID or timestamp:", readingData);
          return;
        }

        if (lastLoggedReadingRef.current[ip] === readingKey) {
          return;
        }

        lastLoggedReadingRef.current[ip] = readingKey;

        // Reset rack timer when a genuinely new reading arrives
        setRackTimer(0);

        // Generate alarm descriptions using existing function
        const alarmResult = alarmComputation(readingData, thresholds);

        const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join(
          "| ",
        )}`;

        // Keep a maximum of 800 logs per device
        setLogsByMac((prev) => {
          const previousLogs = prev[ip] || [];

          const nextLogs = [...previousLogs, entry].slice(-LIVE_LOG_LIMIT);

          return {
            ...prev,
            [ip]: nextLogs,
          };
        });

        setLogTimer(0);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Selected device reading error:", error);
        }
      } finally {
        isFetching = false;
      }
    };

    fetchSelectedReading();

    const interval = setInterval(fetchSelectedReading, READINGS_FETCH_INTERVAL);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [selectedMac]);

  // 🔄 Auto-focus map on selected device
  useEffect(() => {
    if (mapRef.current && selectedMac) {
      const selectedDevice = deviceMeta.find((d) => d.ip === selectedMac);
      const lat = parseFloat(selectedDevice?.latitude);
      const lon = parseFloat(selectedDevice?.longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        mapRef.current.flyTo([lat, lon], 15, { duration: 1.5 });
        // console.log(`🔍 Flying to ${selectedMac} at [${lat}, ${lon}]`);
      }
    }
  }, [selectedMac, deviceMeta]);

  // function shallowEqualDevices(a, b) {
  //   if (a === b) return true;
  //   if (!a || !b) return false;
  //   if (a.length !== b.length) return false;

  //   for (let i = 0; i < a.length; i++) {
  //     if (a[i].ip !== b[i].ip) return false;
  //   }
  //   return true;
  // }

  // FETCH DATA
  // const fetchData = async () => {
  //   if (isFetchingRef.current) {
  //     console.warn("⚠️ Previous fetch still running");
  //     return;
  //   }

  //   isFetchingRef.current = true;

  //   try {
  //     if (!hasLoadedOnceRef.current) {
  //       setLoadingDevices(true);
  //     }

  //     const timedFetch = async (name, url) => {
  //       const start = performance.now();

  //       const res = await fetch(url);

  //       console.log(`${name}: ${(performance.now() - start).toFixed(1)} ms`);

  //       return res;
  //     };

  //     // const [readingsRes, devicesRes, deviceMetaRes] = await Promise.allSettled(
  //     //   [
  //     //     timedFetch("readings", `${PAPI}/${API.readings}`),
  //     //     timedFetch("allDevices", `${PAPI}/${API.allDevices}`),
  //     //     timedFetch("deviceInfo", `${PAPI}/${API.deviceInfo}`),
  //     //   ],
  //     // );

  //     // const [readingsRes, devicesRes, deviceMetaRes, deviceStatusRes] =
  //     //   await Promise.allSettled([
  //     //     timedFetch("readings", `${PAPI}/${API.readings}`),
  //     //     timedFetch("allDevices", `${PAPI}/${API.allDevices}`),
  //     //     timedFetch("deviceInfo", `${PAPI}/${API.deviceInfo}`),
  //     //     timedFetch("deviceStatus", `${PAPI}/${API.deviceStatus}`),
  //     //   ]);

  //     const [devicesRes, deviceMetaRes, deviceStatusRes] =
  //       await Promise.allSettled([
  //         timedFetch("allDevices", `${PAPI}/${API.allDevices}`),
  //         timedFetch("deviceInfo", `${PAPI}/${API.deviceInfo}`),
  //         timedFetch("deviceStatus", `${PAPI}/${API.deviceStatus}`),
  //       ]);

  //     // const [readingsRes, devicesRes, deviceMetaRes] = await Promise.allSettled([
  //     //   fetch(`${PAPI}/${API.readings}`),
  //     //   fetch(`${PAPI}/${API.allDevices}`),
  //     //   fetch(`${PAPI}/${API.deviceInfo}`),
  //     // ]);

  //     // if (readingsRes.status === "fulfilled" && readingsRes.value.ok) {
  //     //   const readingsData = await readingsRes.value.json();
  //     //   setReadings(Array.isArray(readingsData) ? readingsData : []);
  //     // }

  //     // OLD IMPLEMENTATION - KEEP AS FALLBACK
  //     if (!USE_NEW_READING_LOGIC) {
  //       const readingsRes = await timedFetch(
  //         "readings",
  //         `${PAPI}/${API.readings}`,
  //       );

  //       let readingsData = [];

  //       if (readingsRes.ok) {
  //         readingsData = await readingsRes.json();

  //         readingsData = Array.isArray(readingsData) ? readingsData : [];

  //         const isSame =
  //           prevReadingsRef.current.length === readingsData.length &&
  //           readingsData.every((r) => {
  //             const prev = prevReadingsRef.current.find((p) => p.ip === r.ip);

  //             return prev && prev.timestamp === r.timestamp;
  //           });

  //         if (!isSame) {
  //           setReadings(readingsData);
  //           setRackTimer(0);

  //           prevReadingsRef.current = readingsData;

  //           // OLD LIVE LOG GENERATION
  //           const ip = selectedMacRef.current;

  //           if (ip) {
  //             const reading = readingsData.find((r) => r.ip === ip);

  //             if (reading) {
  //               const alarmResult = alarmComputation(reading, thresholds);

  //               const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join("| ")}`;

  //               setLogsByMac((prev) => {
  //                 const prevLogs = prev[ip] || [];

  //                 const nextLogs = [...prevLogs, entry].slice(
  //                   -MAX_LOGS_PER_DEVICE,
  //                 );

  //                 return {
  //                   ...prev,
  //                   [ip]: nextLogs,
  //                 };
  //               });

  //               setLogTimer(0);
  //             }
  //           }
  //         }
  //       }
  //     }

  //     let readingsData = [];

  //     // if (readingsRes.status === "fulfilled" && readingsRes.value.ok) {
  //     //   const data = await readingsRes.value.json();
  //     //   readingsData = Array.isArray(data) ? data : [];

  //     //   const isSame =
  //     //     prevReadingsRef.current.length === readingsData.length &&
  //     //     readingsData.every((r) => {
  //     //       const prev = prevReadingsRef.current.find((p) => p.ip === r.ip);
  //     //       return prev && prev.timestamp === r.timestamp;
  //     //     });

  //     //   console.log("FETCH TIME:", new Date().toLocaleTimeString());
  //     //   // console.log("IS SAME DATA:", isSame);

  //     //   if (!isSame) {
  //     //     // console.log("✅ NEW DATA ARRIVED");

  //     //     setReadings(readingsData);
  //     //     setRackTimer(0);
  //     //     prevReadingsRef.current = readingsData;

  //     //     // 🔥 ADD THIS BLOCK (LOGGING HERE)
  //     //     const ip = selectedMacRef.current;
  //     //     if (ip) {
  //     //       const reading = readingsData.find((r) => r.ip === ip);
  //     //       if (reading) {
  //     //         const alarmResult = alarmComputation(reading, thresholds);

  //     //         const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join("| ")}`;

  //     //         setLogsByMac((prev) => {
  //     //           const prevLogs = prev[ip] || [];
  //     //           const nextLogs = [...prevLogs, entry].slice(
  //     //             -MAX_LOGS_PER_DEVICE,
  //     //           );

  //     //           return {
  //     //             ...prev,
  //     //             [ip]: nextLogs,
  //     //           };
  //     //         });

  //     //         setLogTimer(0);
  //     //       }
  //     //     }
  //     //   } else {
  //     //     console.log("❌ SAME DATA (NO UPDATE)");
  //     //   }

  //     //   // safe logging
  //     //   // console.log("DATA:", readingsData.map(r => ({
  //     //   //   ip: r.ip,
  //     //   //   ts: r.timestamp,
  //     //   //   temp: r.insideTemperature,
  //     //   //   ip: r.ip,
  //     //   //   fan1Status: r.fan1Status,
  //     //   //   fan2Status: r.fan2Status,
  //     //   //   fan3Status: r.fan3Status,
  //     //   //   fan4Status: r.fan4Status,
  //     //   //   fan5Status: r.fan5Status,
  //     //   //   fan6Status: r.fan6Status,
  //     //   //   fanLevel1Running: r.fanLevel1Running,
  //     //   //   fanLevel2Running: r.fanLevel2Running,
  //     //   //   fanLevel3Running: r.fanLevel3Running,
  //     //   //   fanLevel4Running: r.fanLevel4Running
  //     //   // })));
  //     // }

  //     if (devicesRes.status === "fulfilled" && devicesRes.value.ok) {
  //       const devicesData = await devicesRes.value.json();
  //       setDevices(Array.isArray(devicesData) ? devicesData : []);
  //     }

  //     if (deviceMetaRes.status === "fulfilled" && deviceMetaRes.value.ok) {
  //       const metadata = await deviceMetaRes.value.json();

  //       setDeviceMeta((prev) => {
  //         const next = Array.isArray(metadata) ? metadata : [];

  //         if (shallowEqualDevices(prev, next)) {
  //           return prev;
  //         }
  //         return next;
  //       });
  //     }

  //     if (deviceStatusRes.status === "fulfilled" && deviceStatusRes.value.ok) {
  //       const statusPayload = await deviceStatusRes.value.json();
  //       const statusDevices = statusPayload?.data?.devices;

  //       if (statusPayload?.success === true && Array.isArray(statusDevices)) {
  //         const nextStatusMap = {};

  //         for (const device of statusDevices) {
  //           const ip = String(device.ip || "").trim();

  //           if (!ip) continue;

  //           nextStatusMap[ip] = device.dashboardStatus || "disconnected";
  //         }

  //         setDeviceStatusMap(nextStatusMap);
  //       } else {
  //         console.error("Invalid device status API response:", statusPayload);
  //       }
  //     } else {
  //       console.error("Failed to fetch backend device status");
  //     }

  //     // setRackTimer(0);
  //     // console.log("readingData", readingsData);
  //   } catch (err) {
  //     console.error("❌Error fetching data:", err);
  //   } finally {
  //     isFetchingRef.current = false;

  //     if (!hasLoadedOnceRef.current) {
  //       setLoadingDevices(false);
  //       hasLoadedOnceRef.current = true;
  //     }
  //   }
  // };

  useEffect(() => {
    const interval = setInterval(() => {
      setRackTimer((prev) => prev + 1);
      setLogTimer((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleSelectDevice = useCallback((ip, locationId) => {
    setSelectedMac(ip);
    setSelectedDevice(locationId);
  }, []);

  // LOGGING COMMANDS IN SYSTEM
  const sendToLog = async (status, message, command = "") => {
    const logData = {
      date: new Date().toLocaleString(),
      ip: selectedMac,
      command: command,
      status: status,
      message: message,
    };

    try {
      await fetch(`${PAPI}/${API.logCommand}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logData),
      });
    } catch (err) {
      console.error("Failed to log ", err);
    }
  };

  // SENDING COMMAND TO DEVICE
  const sendCommand = async (cmdToSend) => {
    if (!selectedMac || !cmdToSend) {
      setStatus("Please select a device and enter a command.");
      return;
    }
    try {
      const res = await fetch(`/${API.sendCommandToDevice}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: selectedMac, command: cmdToSend }),
      });
      const data = await res.json();
      setStatus(data.message);
    } catch (error) {
      console.error("Command error:", error);
      setStatus("Error sending command");
    }
  };

  // FAN BUTTON CLICK HANDLING
  const handleFanClick = (level) => {
    // const isActive = activeFanBtns.includes(level);
    const isActive =
      level === 5
        ? activeFanBtns.includes(5)
        : latestReading?.[`fanLevel${level}Running`] === true;

    const command = isActive
      ? `%R0${level}F${getFormattedDateTime()}$`
      : `%R0${level}N${getFormattedDateTime()}$`;

    if (level !== 5) {
      sendToLog(
        `Fan Group ${level} clicked ${isActive ? "off" : "on "}`,
        "",
        command,
      );
    } else {
      sendToLog(`LOAD Clicked ${isActive ? "off" : "on "}`, "", command);
    }
    sendCommand(command);
    // console.log("Command: ", command);

    // Update UI immediately (optional, for instant feedback)
    // setActiveFanBtns(
    //   isActive
    //     ? activeFanBtns.filter((l) => l !== level)
    //     : [...activeFanBtns, level]
    // );
    if (level === 5) {
      setActiveFanBtns((prev) =>
        prev.includes(5) ? prev.filter((l) => l !== 5) : [...prev, 5],
      );
    }
  };

  // OPEN LOCK (using Sweetalert2)
  const handleOpenLock = async () => {
    const { value: password } = await swal.fire({
      title: "Enter Admin password",
      input: "password",
      inputAttributes: {
        autocomplete: "new-password",
      },
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

  // RESET LOCK BUTTON
  const handleResetLock = () => {
    const pwd = window.prompt("Enter admin password to reset lock:");
    if (pwd === ADMIN_PASSWORD) {
      const newLock = window.prompt("Enter new lock value:");

      if (/^\d{9}$/.test(newLock)) {
        if (newLock && newLock.trim() !== "") {
          sendToLog(`Lock Reset ${newLock} clicked`);
          sendCommand(`%L00R${newLock}${getFormattedDateTime()}$$`);
          setStatus(`New password ${newLock} `);
        } else {
          setStatus("New lock value cannot be empty!");
        }
      } else {
        alert("Enter Numeric Password of 9 Digits");
      }
    } else {
      setStatus("Wrong password for resetting lock!");
    }
  };

  // Function: RESETTING PASSWORD ATTEMPT
  const openPassword = () => {
    setShowOpenPasswordPrompt(true);
  };

  const handleOpenPasswordSubmit = (password) => {
    if (!password) return;

    if (password === ADMIN_PASSWORD) {
      sendCommand(`%L00P${getFormattedDateTime()}$`);
      sendToLog("Password Open Button Clicked");
      setStatus("Password opened successfully!");
    } else {
      setStatus("Wrong password for opening lock!");
    }

    setShowOpenPasswordPrompt(false);
  };

  const handleOpenPasswordCancel = () => {
    setShowOpenPasswordPrompt(false);
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
    if (reading.pwsFailCount === 3) alarms.push("Password Blocked ");
    if (reading.mainStatus === 0) alarms.push("Main Alarm");
    if (reading.rectStatus === 0) alarms.push("Rectifier Alarm");
    if (reading.inveStatus === 0) alarms.push("Inverter Alarm");
    if (reading.overStatus === 0) alarms.push("Overload Alarm");
    if (reading.mptStatus === 0) alarms.push("MPT Alarm");
    if (reading.mosfStatus === 0) alarms.push("MOSFET Alarm");

    // threshold-based
    if (
      reading.insideTemperatureAlarm &&
      reading.insideTemperature < thresholds.insideTemperature.min
    )
      alarms.push("Low In. Temp. ");
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

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/");
  };

  // DEVICE STATUS COMPUTATION FOR MAP & DEVICE PANEL
  // useEffect(() => {
  //   setDeviceStatusMap((prev) => {
  //     let hasChange = false;
  //     const updated = { ...prev };

  //     for (const device of deviceMeta) {
  //       const ip = device.ip;
  //       const reading = latestReadingsByMac[ip];

  //       const newStatus = computeColor(reading, STALE_THRESHOLD_MS);

  //       if (prev[ip] !== newStatus) {
  //         updated[ip] = newStatus;
  //         hasChange = true;
  //       }
  //     }

  //     return hasChange ? updated : prev;
  //   });
  // }, [deviceMeta, latestReadingsByMac]);

  // STORING LOGS BASED ON SELECTED MAC
  useEffect(() => {
    latestReadingsByMacRef.current = latestReadingsByMac;
  }, [latestReadingsByMac]);

  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     const ip = selectedMacRef.current;
  //     if (!ip) return;

  //     const reading = latestReadingsByMacRef.current[ip];
  //     if (!reading) return;

  //     const alarmResult = alarmComputation(reading, thresholds);
  //     if (alarmResult.alarms.length === 0) return;

  //     const now = Date.now();
  //     const lastAt = lastAlarmLogAtByMacRef.current[ip] || 0;
  //     if (now - lastAt < LOG_THROTTLE_MS) return;

  //     lastAlarmLogAtByMacRef.current[ip] = now;

  //     setLogsByMac(prev => {
  //       const prevLogs = prev[ip] || [];
  //       const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join("| ")}`;
  //       const nextLogs = [...prevLogs, entry].slice(-MAX_LOGS_PER_DEVICE);

  //       return {
  //         ...prev,
  //         [ip]: nextLogs
  //       };
  //     });

  //     setLogTimer(0);
  //   }, 1000);

  //   return () => clearInterval(interval);
  // }, []);

  // useEffect(() => {

  //   const ip = selectedMac;
  //   if (!ip) return;

  //   const reading = latestReadingsByMac[ip];
  //   if (!reading) return;

  //   const alarmResult = alarmComputation(reading, thresholds);
  //   if (alarmResult.alarms.length === 0) return;

  //   const now = Date.now();
  //   const lastAt = lastAlarmLogAtByMacRef.current[ip] || 0;

  //   if (now - lastAt < LOG_THROTTLE_MS) return;

  //   lastAlarmLogAtByMacRef.current[ip] = now;

  //   setLogsByMac(prev => {
  //     const prevLogs = prev[ip] || [];

  //     const entry = `[${new Date().toLocaleTimeString()}] [${ip}] ${alarmResult.alarms.join("| ")}`;

  //     const nextLogs = [...prevLogs, entry].slice(-MAX_LOGS_PER_DEVICE);

  //     return {
  //       ...prev,
  //       [ip]: nextLogs
  //     };
  //   });

  //   console.log("NEW DATA", reading.timestamp);
  //   console.log("ALARMS", alarmResult.alarms);

  //   setLogTimer(0);

  // }, [latestReadingsByMac, selectedMac]);

  //* STOPPING LOGS FROM DELETING AT REFRESH
  useEffect(() => {
    if (USE_NEW_READING_LOGIC) return;

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
    if (USE_NEW_READING_LOGIC) return;

    // Reseting Logs after every 1 hour
    const logTimer = setInterval(() => {
      lastResetAtRef.current = Date.now();
      setLogsByMac({});
      // keep persisted value in sync with in-memory reset
      try {
        window?.localStorage?.setItem(
          LOG_STORAGE_KEY,
          JSON.stringify({
            lastResetAt: lastResetAtRef.current,
            logsByMac: {},
          }),
        );
      } catch {
        // ignoree
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
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    if (distanceFromBottom <= 2) {
      setAutoScroll(true);
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  // FUNCTION FOR FETCHING SNAPSHOTS BY "IP"
  const fetchSnapshots = async (selectedMac) => {
    try {
      if (!selectedMac) return;

      // setActiveTab("snapshots");
      // if (selectedMac && activeTab === "snapshots") {
      let response = await fetch(`/api/snapshots?ip=${selectedMac}`);
      const snapshotFiles = await response.json();
      setSnapshots(snapshotFiles);
      // } else {
      //   setSnapshots([]);
      // }
    } catch (err) {
      console.error("Error fetching snapshots:", err);
    }
  };

  // RUNNING SNAPSHOT FETCHING FUNCTION
  useEffect(() => {
    // Fetching snapshot only when snapshot tab is active
    if (activeTab !== "snapshots" || !selectedMac) return;

    fetchSnapshots(selectedMac);
  }, [activeTab, selectedMac]);

  // Fetch snapshots on component mount
  useEffect(() => {
    fetchSnapshots(selectedMac);

    const snapshotInterval = setInterval(() => {
      fetchSnapshots(selectedMac);
    }, SNAPSHOT_FETCH_INTERVAL); // ✅ Set up timer

    return () => clearInterval(snapshotInterval); // ✅ Cleanup
  }, [selectedMac]);

  // NOTIFICATION WHEN SNAPSHOT IS CAPTURED (server-sent events)
  useEffect(() => {
    // const baseUrl = API;
    // if (!baseUrl) return;

    // const es = new EventSource(`${baseUrl}/api/events/snapshots`);
    const es = new EventSource(`/api/events/snapshots`);

    const onSnapshot = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        const ip = payload?.ip;
        if (!ip) return;

        swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: `Snapshot captured IP: ${ip}`,
          // text: `MAC: ${ip}`,
          timer: 10000,
          timerProgressBar: true,
          showConfirmButton: false,
          showCloseButton: true,
          backdrop: false,
          width: 300,
          height: 100,
        });

        // If user is viewing the same device, refresh the snapshot list
        if (
          String(selectedMacRef.current).toLowerCase() ===
          String(ip).toLowerCase()
        ) {
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
      list = list.filter((device) => {
        const status = deviceStatusMap[device.ip] || "disconnected";
        return status === statusFilter;
      });
    }

    // Search filter
    if (searchTerm.trim() !== "") {
      const lower = searchTerm.toLowerCase();

      list = list.filter(
        (device) =>
          device.locationId?.toLowerCase().includes(lower) ||
          device.ip?.toLowerCase().includes(lower),
      );
    }

    return list;
  }, [deviceMeta, deviceStatusMap, statusFilter, searchTerm]);

  const alarmKeys = ALARM_KEYS;

  const statusKeys = STATUS_KEYS;

  const hupsKeys = HUPS_KEYS;

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
        {showOpenPasswordPrompt && (
          <PasswordPrompt
            onSubmit={handleOpenPasswordSubmit}
            onCancel={handleOpenPasswordCancel}
          />
        )}

        {/* PANEL 1: READINGS PANEL */}
        <div className="panel">
          <div className="rack-header">
            <h2 className="selected-heading">
              📟 Selected Rack: {selectedMac && <span> {selectedDevice}</span>}
            </h2>

            {/* <div style={{ fontSize: "14px", marginTop: "5px" }}>
              ⏱ Rack Refresh: {5 - rackTimer}
            </div> */}

            {/* ALARM TOGGLE */}
            <div className="alarm-container">
              <span>Alarm</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={alarmToggle}
                  onChange={(e) => setAlarmToggle(e.target.checked)}
                />
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
                  onClick={() => {
                    setActiveTab("snapshots");
                  }}
                  // onClick={() => { setActiveTab("snapshots"); fetchSnapshots(selectedMac); }}
                >
                  Snapshots
                </button>
              </div>

              {/* GAUGES TAB */}
              {activeTab === "gauges" && (
                <div className="gauges grid-3x3">
                  <Gauge
                    label="Inside Temp"
                    value={latestReading.insideTemperature.toFixed(2)}
                    max={100}
                    color={
                      latestReading.insideTemperature <
                      thresholds.insideTemperature.min
                        ? "#ec7632"
                        : latestReading.insideTemperature >=
                            thresholds.insideTemperature.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.insideTemperatureAlarm : false
                    }
                  />
                  <Gauge
                    label="Outside Temp"
                    value={latestReading.outsideTemperature.toFixed(2)}
                    max={100}
                    color={
                      latestReading.outsideTemperature <
                      thresholds.outsideTemperature.min
                        ? "#ec7632"
                        : latestReading.outsideTemperature >=
                            thresholds.outsideTemperature.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={
                      alarmToggle
                        ? latestReading.outsideTemperatureAlarm
                        : false
                    }
                  />
                  <Gauge
                    label="Humidity"
                    value={latestReading.humidity}
                    max={100}
                    color={
                      latestReading.humidity < thresholds.humidity.min
                        ? "#ec7632"
                        : latestReading.humidity >= thresholds.humidity.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={alarmToggle ? latestReading.humidityAlarm : false}
                  />
                  <Gauge
                    label="Input Volt"
                    value={latestReading.inputVoltage.toFixed(2)}
                    max={100}
                    color={
                      latestReading.inputVoltage < thresholds.inputVoltage.min
                        ? "#ec7632"
                        : latestReading.inputVoltage >=
                            thresholds.inputVoltage.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.inputVoltageAlarm : false
                    }
                  />
                  <Gauge
                    label="Output Volt"
                    value={latestReading.outputVoltage.toFixed(2)}
                    max={100}
                    color={
                      latestReading.outputVoltage < thresholds.outputVoltage.min
                        ? "#ec7632"
                        : latestReading.outputVoltage >=
                            thresholds.outputVoltage.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.outputVoltageAlarm : false
                    }
                  />
                  <Gauge
                    label="DV Current"
                    value={latestReading.hupsDVC.toFixed(2)}
                    max={45}
                    color={
                      latestReading.inputVoltage < thresholds.inputVoltage.min
                        ? "#ec7632"
                        : latestReading.inputVoltage >=
                            thresholds.inputVoltage.max
                          ? "#fb1616"
                          : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.inputVoltageAlarm : false
                    }
                  />
                  <Gauge
                    label="Battery %"
                    value={latestReading.hupsSOC.toFixed(2)}
                    max={120}
                    color={
                      latestReading.batteryBackup <=
                      thresholds.batteryBackup.min
                        ? "#ec7632"
                        : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.batteryBackupAlarm : false
                    }
                  />
                  <Gauge
                    label="Battery(Hours)"
                    value={latestReading.hupsBatBackup.toFixed(2)}
                    max={120}
                    color={
                      latestReading.batteryBackup <=
                      thresholds.batteryBackup.min
                        ? "#ec7632"
                        : "#67b816"
                    }
                    alarm={
                      alarmToggle ? latestReading.batteryBackupAlarm : false
                    }
                  />
                  {latestReading.batteryBackup <= 10 ? (
                    <Gauge
                      label="LockBat(Left..)"
                      value={0}
                      max={12}
                      color={
                        latestReading.batteryBackup <=
                        thresholds.batteryBackup.min
                          ? "#ec7632"
                          : "#67b816"
                      }
                      alarm={
                        alarmToggle ? latestReading.batteryBackupAlarm : false
                      }
                    />
                  ) : (
                    <Gauge
                      label="LockBat(Left..)"
                      value={Math.floor((latestReading.batteryBackup - 9) * 4)}
                      // value={6}
                      max={12}
                      color={
                        latestReading.batteryBackup <=
                        thresholds.batteryBackup.min
                          ? "#ec7632"
                          : "#67b816"
                      }
                      hoverTitle={"LockBat Left Hours"}
                      alarm={
                        alarmToggle ? latestReading.batteryBackupAlarm : false
                      }
                    />
                  )}
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
                          className={`alarm-led ${
                            alarm.key === "fireAlarm"
                              ? latestReading[alarm.key] === 80
                                ? "wait"
                                : latestReading[alarm.key] === 81
                                  ? "fireWait"
                                  : latestReading[alarm.key] === 2
                                    ? "smoke"
                                    : latestReading[alarm.key] === 1
                                      ? "active"
                                      : latestReading[alarm.key] === 3
                                        ? "active"
                                        : ""
                              : latestReading[alarm.key]
                                ? "active"
                                : ""
                          }`}
                        />
                        <div className="alarm-label">{alarm.Name}</div>
                      </div>
                    ))}
                    {statusKeys.map((status, i) => {
                      if (status.key !== "pwsFailCount") {
                        return (
                          <div key={i} className="alarm-indicator">
                            <div
                              className={`alarm-led ${
                                latestReading[status.key] === "OPEN"
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
                            ${
                              latestReading[status.key] === 1
                                ? "danger"
                                : latestReading[status.key] === 2
                                  ? "warn"
                                  : latestReading[status.key] === 3
                                    ? "active"
                                    : ""
                            }`}
                              />
                              <div className="alarm-label">{status.Name}</div>
                              <div className="alarm-attempt">
                                {3 - latestReading[status.key]} Attempt Left
                              </div>
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
                          className={`alarm-led ${
                            latestReading[hups.key] ? "" : "active"
                          }`}
                        />
                        <div className="alarm-label">{hups.Name}</div>
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
                          // className={`power-btn ${activeFanBtns.includes(level) ||
                          //   (latestReading &&
                          //     latestReading[`fanLevel${level}Running`] === true)
                          //   ? "active"
                          //   : ""
                          //   }`}
                          className={`power-btn ${
                            level === 5
                              ? activeFanBtns.includes(5)
                                ? "active"
                                : ""
                              : latestReading?.[`fanLevel${level}Running`] ===
                                  true
                                ? "active"
                                : ""
                          }`}
                          onClick={() => handleFanClick(level)}
                        />
                        <div className="fan-label">
                          {level >= 1 && level <= 4
                            ? `FG ${level}`
                            : "NON-CRITICAL LOAD"}
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
                          `${PAPI}/snapshots/${img}?ip=${selectedMac}` ===
                          selectedImage,
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
                              `${PAPI}/snapshots/${img}?ip=${selectedMac}` ===
                              selectedImage,
                          );
                          const prevIndex =
                            (currentIndex - 1 + snapshots.length) %
                            snapshots.length;
                          setSelectedImage(
                            `${PAPI}/snapshots/${snapshots[prevIndex]}?ip=${selectedMac}`,
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
                              `${PAPI}/snapshots/${img}?ip=${selectedMac}` ===
                              selectedImage,
                          );
                          const nextIndex =
                            (currentIndex + 1) % snapshots.length;
                          setSelectedImage(
                            `${PAPI}/snapshots/${snapshots[nextIndex]}?ip=${selectedMac}`,
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
                              `${PAPI}/snapshots/${filename}?ip=${selectedMac}`,
                            )
                          }
                        >
                          <img
                            key={i}
                            src={`${PAPI}/snapshots/${filename}?ip=${selectedMac}`}
                            alt={`snapshot-${i + 1}`}
                            onError={(e) => {
                              e.target.src =
                                "https://via.placeholder.com/120x90?text=Error";
                            }}
                          />
                          <div className="snapshot-label">
                            {filename.slice(0, 23)}
                          </div>
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

        {/* PANEL 2: LOGS */}
        <div className="panel">
          <div className="flex items-center justify-between mb-2">
            <h2>
              📈 Live Logs
              {/* <span style={{ fontSize: "12px", marginLeft: "10px" }}>
                🔄 Logs Refresh: {Math.max(5 - logTimer, 0)}
              </span> */}
            </h2>
            {role !== "admin" && (
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1 text-sm font-semibold text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Logout
              </button>
            )}
          </div>

          {/* LOG SECTION */}
          <div
            className="w-full h-64 overflow-y-auto bg-black border rounded-md log-scroll"
            onScroll={handleScroll}
          >
            <div className="log-panel">
              {/* {Object.keys(logsByMac).length === 0 ? (
                <p>No logs in last 1 hour</p>
              ) : (
                currentLogs.map((line, i) => (
                  <pre key={i} className="log-line">
                    {line}
                  </pre>
                ))
              )} */}

              {currentLogs.length === 0 ? (
                <p>No live logs available for this device</p>
              ) : (
                currentLogs.map((line, i) => (
                  <pre key={i} className="log-line">
                    {line}
                  </pre>
                ))
              )}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>

        {/* PANEL 3: DEVICE PANEL */}
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

        {/* PANEL 4: MAP PANEL */}
        <div className="panel device-map">
          <DeviceMap
            deviceMeta={deviceMeta}
            deviceStatusMap={deviceStatusMap}
            selectedMac={selectedMac}
            onMarkerClick={setSelectedMac}
          />
        </div>
      </div>
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
