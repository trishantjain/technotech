import React, { useEffect, useState, useRef } from "react";
import "../../App.css";
import { API } from "../../config/api.js";

import { CalendarDays, Clock3 } from "lucide-react";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const api = "/api";

const HistoricalDataTab = () => {
  const [devices, setDevices] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [alarmEntries, setAlarmEntries] = useState([]);

  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [limit] = useState(100);

  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  const [selectedSeverity, setSelectedSeverity] = useState(null);
  const [severityAlarms, setSeverityAlarms] = useState([]);
  const [severityAlarmLoading, setSeverityAlarmLoading] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFromTimePicker, setShowFromTimePicker] = useState(false);
  const [showToTimePicker, setShowToTimePicker] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (date) {
      return new Date(`${date}T00:00:00`);
    }

    return new Date();
  });

  //   const dateInputRef = useRef(null);
  //   const fromTimeInputRef = useRef(null);
  //   const toTimeInputRef = useRef(null);

  // ======================================================
  // DEVICE FILTER
  // ======================================================

  const filteredDevices = devices.filter((dev) =>
    String(dev.ip || "")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  // ======================================================
  // LOAD DEVICES
  // ======================================================

  useEffect(() => {
    fetch(`${api}/${API.deviceInfo}`)
      .then((res) => res.json())
      .then(setDevices)
      .catch((err) => console.error("Error fetching devices:", err));
  }, []);

  // ======================================================
  // SEARCH
  // ======================================================

  const search = () => {
    if (page !== 1) {
      setPage(1);
    } else {
      fetchHistoricalData();
    }
  };

  // ======================================================
  // PAGE CHANGE
  // ======================================================

  useEffect(() => {
    if (selectedMac && date && time && toTime) {
      fetchHistoricalData();
    }
  }, [page]);

  // ======================================================
  // FETCH ALARM HISTORY
  // ======================================================

  const fetchHistoricalData = async () => {
    if (!date || !time || !toTime || !selectedMac) {
      alert("Please select device, date, from time and to time.");
      return;
    }

    const fromDateTime = `${date}T${time.length === 5 ? time + ":00" : time}`;

    const toDateTime = `${date}T${
      toTime.length === 5 ? toTime + ":00" : toTime
    }`;

    const fromObj = new Date(fromDateTime);
    const toObj = new Date(toDateTime);
    const now = new Date();

    if (isNaN(fromObj.getTime()) || isNaN(toObj.getTime())) {
      alert("Invalid date/time format");
      return;
    }

    if (fromObj > now || toObj > now) {
      alert("Cannot select future time");
      return;
    }

    if (toObj < fromObj) {
      alert("'To' time must be after 'From' time");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `${api}/alarm-history?` +
          `ip=${encodeURIComponent(selectedMac.trim())}` +
          `&from=${encodeURIComponent(fromDateTime)}` +
          `&to=${encodeURIComponent(toDateTime)}` +
          `&page=${page}` +
          `&limit=${limit}`,
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch alarm history");
      }

      setAlarmEntries(data.entries || []);
      setTotalPages(data.totalPages || 1);
      setTotalRecords(data.total || 0);
    } catch (err) {
      console.error("Alarm history error:", err);
      alert(err.message || "Failed to fetch alarm history");
    } finally {
      setLoading(false);
    }
  };

  const handleAlarmCardClick = (severity) => {
    const normalizedSeverity = String(severity).toUpperCase();

    // Click the same card again -> remove filter
    if (selectedSeverity === normalizedSeverity) {
      setSelectedSeverity(null);
      setSeverityAlarms([]);
      return;
    }

    setSelectedSeverity(normalizedSeverity);

    const filteredAlarms = alarmEntries.filter(
      (alarm) =>
        String(alarm.severity || "").toUpperCase() === normalizedSeverity,
    );

    setSeverityAlarms(filteredAlarms);
  };

  // ======================================================
  // DATE FORMAT
  // ======================================================

  const formatDateTime = (value) => {
    if (!value || value === "null") {
      return "-";
    }

    const dateObj = new Date(value);

    if (isNaN(dateObj.getTime())) {
      return value;
    }

    return dateObj
      .toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      .replace(",", " |");
  };

  // ======================================================
  // SUMMARY COUNTS
  // ======================================================

  const criticalCount = alarmEntries.filter(
    (entry) => String(entry.severity).toUpperCase() === "CRITICAL",
  ).length;

  const majorCount = alarmEntries.filter(
    (entry) => String(entry.severity).toUpperCase() === "MAJOR",
  ).length;

  const minorCount = alarmEntries.filter(
    (entry) => String(entry.severity).toUpperCase() === "MINOR",
  ).length;

  const activeCount = alarmEntries.filter(
    (entry) => String(entry.status).toLowerCase() === "active",
  ).length;

  const clearedCount = alarmEntries.filter(
    (entry) => String(entry.status).toLowerCase() === "cleared",
  ).length;

  // ======================================================
  // SEVERITY STYLE
  // ======================================================

  const getSeverityStyle = (severity) => {
    const value = String(severity || "").toUpperCase();

    if (value === "CRITICAL") {
      return {
        dot: "bg-red-500",
        badge: "bg-red-500/10 text-red-300 border border-red-500/30",
        rowBorder: "border-l-red-500",
      };
    }

    if (value === "MAJOR") {
      return {
        dot: "bg-orange-500",
        badge: "bg-orange-500/10 text-orange-300 border border-orange-500/30",
        rowBorder: "border-l-orange-500",
      };
    }

    return {
      dot: "bg-yellow-400",
      badge: "bg-yellow-500/10 text-yellow-300 border border-yellow-500/30",
      rowBorder: "border-l-yellow-400",
    };
  };

  // ======================================================
  // STATUS STYLE
  // ======================================================

  const getStatusStyle = (status) => {
    const value = String(status || "").toLowerCase();

    if (value === "cleared") {
      return {
        dot: "bg-emerald-400",
        badge:
          "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
      };
    }

    return {
      dot: "bg-blue-400",
      badge: "bg-blue-500/10 text-blue-300 border border-blue-500/30",
    };
  };

  // ======================================================
  // STAT CARD
  // ======================================================

  const StatCard = ({
    label,
    value,
    color,
    border,
    clickable = false,
    active = false,
    onClick,
  }) => {
    return (
      <div
        onClick={clickable ? onClick : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={(e) => {
          if (clickable && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={`
        rounded-xl
        border
        ${border}
        bg-[#111827]
        p-4
        transition-all
        duration-200
        select-none
        ${
          clickable
            ? "cursor-pointer hover:scale-[1.02] hover:bg-[#172033]"
            : ""
        }
        ${active ? "ring-2 ring-blue-500 shadow-lg shadow-blue-500/10" : ""}
      `}
      >
        <div className="text-sm text-gray-400">{label}</div>

        <div className={`mt-2 text-3xl font-bold ${color}`}>{value}</div>

        {clickable && (
          <div className="mt-1 text-xs text-gray-500">
            {active ? "Click to clear filter" : "Click to view alarms"}
          </div>
        )}
      </div>
    );
  };

  const displayedAlarms = selectedSeverity
  ? severityAlarms
  : alarmEntries;

  return (
    <div className="min-h-screen p-6 text-gray-100 bg-[#0b0f14]">
      {/* ================================================= */}
      {/* PAGE HEADER */}
      {/* ================================================= */}

      <div className="flex flex-col gap-4 pb-6 mb-6 border-b border-gray-800 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 border rounded-lg border-blue-500/30 bg-blue-500/10">
              <span className="text-lg text-blue-400">!</span>
            </div>

            <div>
              <h1 className="text-2xl font-semibold text-white">
                Historical Alarms
              </h1>

              <p className="mt-1 text-sm text-gray-400">
                Review alarm events and lifecycle history for monitored devices.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-lg">
          <span className="w-2 h-2 bg-green-400 rounded-full" />
          EMS Historical Data
        </div>
      </div>

      {/* ================================================= */}
      {/* FILTER PANEL */}
      {/* ================================================= */}

      <div className="mb-6 overflow-visible border border-gray-800 rounded-xl bg-[#11161d]">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">
            Search Criteria
          </h2>

          <p className="mt-1 text-xs text-gray-500">
            Select a device and time range to retrieve historical alarms.
          </p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
            {/* DEVICE */}

            <div className="relative xl:col-span-1">
              <label className="block mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
                Device IP
              </label>

              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search device IP"
                className="w-full px-4 py-2.5 text-sm text-white placeholder-gray-600 bg-[#0b0f14] border border-gray-700 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />

              {showDropdown && (
                <div className="absolute z-50 w-full mt-2 overflow-hidden overflow-y-auto border border-gray-700 rounded-lg shadow-2xl bg-[#11161d] max-h-60">
                  {filteredDevices.length > 0 ? (
                    filteredDevices.map((dev) => (
                      <button
                        key={dev.ip}
                        type="button"
                        onClick={() => {
                          setQuery(dev.ip);
                          setSelectedMac(dev.ip);
                          setShowDropdown(false);
                        }}
                        className="w-full px-4 py-3 text-sm text-left text-gray-300 border-b border-gray-800 last:border-0 hover:bg-blue-500/10 hover:text-white"
                      >
                        {dev.ip}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      No matching devices found
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ================================================= */}
            {/* DATE */}
            {/* ================================================= */}

            <div>
              <label className="block mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
                Date
              </label>

              <DatePicker
                selected={date ? new Date(`${date}T00:00:00`) : null}
                onChange={(selectedDate) => {
                  if (!selectedDate) {
                    setDate("");
                    return;
                  }

                  const pad = (value) => String(value).padStart(2, "0");

                  setDate(
                    `${selectedDate.getFullYear()}-${pad(
                      selectedDate.getMonth() + 1,
                    )}-${pad(selectedDate.getDate())}`,
                  );
                }}
                dateFormat="dd/MM/yyyy"
                maxDate={new Date()}
                popperClassName="historical-datepicker-popper"
                customInput={
                  <button
                    type="button"
                    className="flex items-center w-full gap-3 px-4 py-3 text-sm text-left text-gray-200 transition border border-gray-700 rounded-xl bg-gray-950 hover:border-gray-500 focus:border-blue-500"
                  >
                    <CalendarDays size={18} className="text-blue-400" />

                    <span>
                      {date
                        ? new Date(`${date}T00:00:00`).toLocaleDateString(
                            "en-GB",
                          )
                        : "Select Date"}
                    </span>
                  </button>
                }
              />
            </div>

            {/* ================================================= */}
            {/* FROM TIME */}
            {/* ================================================= */}

            <div>
              <label className="block mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
                From Time
              </label>

              <DatePicker
                selected={time ? new Date(`2000-01-01T${time}`) : null}
                onChange={(selectedTime) => {
                  if (!selectedTime) {
                    setTime("");
                    return;
                  }

                  const pad = (value) => String(value).padStart(2, "0");

                  setTime(
                    `${pad(selectedTime.getHours())}:${pad(
                      selectedTime.getMinutes(),
                    )}:${pad(selectedTime.getSeconds())}`,
                  );
                }}
                showTimeSelect
                showTimeSelectOnly
                timeIntervals={1}
                timeCaption="From Time"
                dateFormat="HH:mm:ss"
                timeFormat="HH:mm:ss"
                popperClassName="historical-datepicker-popper"
                customInput={
                  <button
                    type="button"
                    className="flex items-center w-full gap-3 px-4 py-3 text-sm text-left text-gray-200 transition border border-gray-700 rounded-xl bg-gray-950 hover:border-gray-500 focus:border-blue-500"
                  >
                    <Clock3 size={18} className="text-blue-400" />

                    <span>{time || "Select From Time"}</span>
                  </button>
                }
              />
            </div>

            {/* ================================================= */}
            {/* TO TIME */}
            {/* ================================================= */}

            <div>
              <label className="block mb-2 text-xs font-medium tracking-wide text-gray-400 uppercase">
                To Time
              </label>

              <DatePicker
                selected={toTime ? new Date(`2000-01-01T${toTime}`) : null}
                onChange={(selectedTime) => {
                  if (!selectedTime) {
                    setToTime("");
                    return;
                  }

                  const pad = (value) => String(value).padStart(2, "0");

                  setToTime(
                    `${pad(selectedTime.getHours())}:${pad(
                      selectedTime.getMinutes(),
                    )}:${pad(selectedTime.getSeconds())}`,
                  );
                }}
                showTimeSelect
                showTimeSelectOnly
                timeIntervals={1}
                timeCaption="To Time"
                dateFormat="HH:mm:ss"
                timeFormat="HH:mm:ss"
                popperClassName="historical-datepicker-popper"
                customInput={
                  <button
                    type="button"
                    className="flex items-center w-full gap-3 px-4 py-3 text-sm text-left text-gray-200 transition border border-gray-700 rounded-xl bg-gray-950 hover:border-gray-500 focus:border-blue-500"
                  >
                    <Clock3 size={18} className="text-blue-400" />

                    <span>{toTime || "Select To Time"}</span>
                  </button>
                }
              />
            </div>

            {/* BUTTON */}

            <div className="flex items-end">
              <button
                onClick={search}
                disabled={loading}
                className={`w-full px-5 py-2.5 rounded-lg text-sm font-semibold transition-all
                  ${
                    loading
                      ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-500"
                  }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-gray-400 rounded-full border-t-white animate-spin" />
                    Loading
                  </span>
                ) : (
                  "Search Alarms"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================= */}
      {/* SUMMARY */}
      {/* ================================================= */}

      <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-6">
        <StatCard
          label="Total Records"
          value={totalRecords}
          color="text-white"
          border="border-gray-800"
        />

        {/* CRITICAL */}
        <StatCard
          label="Critical"
          value={criticalCount}
          color="text-red-400"
          border="border-red-500/20"
          clickable={true}
          active={selectedSeverity === "CRITICAL"}
          onClick={() => handleAlarmCardClick("CRITICAL")}
        />

        {/* MAJOR */}
        <StatCard
          label="Major"
          value={majorCount}
          color="text-orange-400"
          border="border-orange-500/20"
          clickable={true}
          active={selectedSeverity === "MAJOR"}
          onClick={() => handleAlarmCardClick("MAJOR")}
        />

        {/* MINOR */}
        <StatCard
          label="Minor"
          value={minorCount}
          color="text-yellow-300"
          border="border-yellow-500/20"
          clickable={true}
          active={selectedSeverity === "MINOR"}
          onClick={() => handleAlarmCardClick("MINOR")}
        />

        <StatCard
          label="Active"
          value={activeCount}
          color="text-blue-400"
          border="border-blue-500/20"
        />

        <StatCard
          label="Cleared"
          value={clearedCount}
          color="text-emerald-400"
          border="border-emerald-500/20"
        />
      </div>

      {/* ================================================= */}
      {/* RESULTS PANEL */}
      {/* ================================================= */}

      <div className="overflow-hidden border border-gray-800 rounded-xl bg-[#11161d]">
        {/* RESULTS HEADER */}

        <div className="flex flex-col gap-4 px-6 py-5 border-b border-gray-800 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Alarm Records</h2>

            <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
              {selectedMac && (
                <span className="px-2 py-1 bg-gray-800 border border-gray-700 rounded">
                  Device: <span className="text-gray-300">{selectedMac}</span>
                </span>
              )}

              {date && (
                <span className="px-2 py-1 bg-gray-800 border border-gray-700 rounded">
                  Date: <span className="text-gray-300">{date}</span>
                </span>
              )}

              {time && toTime && (
                <span className="px-2 py-1 bg-gray-800 border border-gray-700 rounded">
                  Range:{" "}
                  <span className="text-gray-300">
                    {time} - {toTime}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="text-sm text-gray-400">
            {totalRecords > 0
              ? `${totalRecords.toLocaleString()} records found`
              : "No records loaded"}
          </div>
        </div>

        {/* ================================================= */}
        {/* LOADING */}
        {/* ================================================= */}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <div className="w-10 h-10 border-4 border-gray-700 rounded-full border-t-blue-500 animate-spin" />

            <div className="text-sm text-gray-400">
              Retrieving historical alarm records...
            </div>
          </div>
        ) : alarmEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex items-center justify-center mb-4 bg-gray-900 border border-gray-700 rounded-full w-14 h-14">
              <span className="text-xl text-gray-500">!</span>
            </div>

            <h3 className="font-medium text-gray-300">
              No alarm records found
            </h3>

            <p className="max-w-sm mt-2 text-sm text-gray-500">
              Select a device and valid time range, then search for historical
              alarm events.
            </p>
          </div>
        ) : (
          <>
            {/* ================================================= */}
            {/* TABLE */}
            {/* ================================================= */}

            <div className="overflow-auto max-h-[650px]">
              <table className="min-w-full text-sm text-left">
                <thead className="sticky top-0 z-20 border-b border-gray-700 bg-[#171d25]">
                  <tr className="text-[11px] tracking-wider text-gray-400 uppercase">
                    <th className="px-5 py-4 font-semibold">Alert ID</th>

                    <th className="px-5 py-4 font-semibold">Device</th>

                    <th className="px-5 py-4 font-semibold">Severity</th>

                    <th className="px-5 py-4 font-semibold min-w-[220px]">
                      Alarm Description
                    </th>

                    <th className="px-5 py-4 font-semibold">Alarm Value</th>

                    <th className="px-5 py-4 font-semibold whitespace-nowrap">
                      Start Time
                    </th>

                    <th className="px-5 py-4 font-semibold whitespace-nowrap">
                      End Time
                    </th>

                    <th className="px-5 py-4 font-semibold">Status</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-800">
                  {displayedAlarms.map((row, idx) => {
                    const severityStyle = getSeverityStyle(row.severity);

                    const statusStyle = getStatusStyle(row.status);

                    return (
                      <tr
                        key={row.alert_id || idx}
                        className={`border-l-[3px] ${
                          severityStyle.rowBorder
                        } transition-colors ${
                          idx % 2 === 0 ? "bg-[#11161d]" : "bg-[#0e1319]"
                        } hover:bg-blue-500/5`}
                      >
                        {/* ALERT ID */}

                        <td className="px-5 py-4">
                          <span className="font-mono text-xs text-blue-300">
                            {row.alert_id || "-"}
                          </span>
                        </td>

                        {/* DEVICE */}

                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className="font-medium text-gray-200">
                            {row.device_ip || selectedMac}
                          </span>
                        </td>

                        {/* SEVERITY */}

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase rounded-md ${severityStyle.badge}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${severityStyle.dot}`}
                            />

                            {String(row.severity || "-").toUpperCase()}
                          </span>
                        </td>

                        {/* ALARM */}

                        <td className="px-5 py-4">
                          <span className="font-medium text-gray-200">
                            {row.alarm || "-"}
                          </span>
                        </td>

                        {/* VALUE */}

                        <td className="px-5 py-4 text-gray-400">
                          {row.alarm_value || "-"}
                        </td>

                        {/* START */}

                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className="font-mono text-xs text-gray-300">
                            {formatDateTime(row.start_time)}
                          </span>
                        </td>

                        {/* END */}

                        <td className="px-5 py-4 whitespace-nowrap">
                          {row.end_time && row.end_time !== "null" ? (
                            <span className="font-mono text-xs text-emerald-300">
                              {formatDateTime(row.end_time)}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>

                        {/* STATUS */}

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-semibold rounded-md ${statusStyle.badge}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`}
                            />

                            {row.status || "Active"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ================================================= */}
            {/* PAGINATION */}
            {/* ================================================= */}

            <div className="flex flex-col gap-4 px-6 py-4 border-t border-gray-800 bg-[#0e1319] sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-gray-500">
                Showing{" "}
                <span className="font-medium text-gray-300">
                  {totalRecords === 0 ? 0 : (page - 1) * limit + 1}
                </span>
                {" – "}
                <span className="font-medium text-gray-300">
                  {Math.min(page * limit, totalRecords)}
                </span>
                {" of "}
                <span className="font-medium text-gray-300">
                  {totalRecords}
                </span>
                {" records"}
              </div>

              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">
                  Page <span className="text-gray-300">{page}</span> of{" "}
                  <span className="text-gray-300">{totalPages}</span>
                </span>

                <div className="flex gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="px-4 py-2 text-xs font-medium text-gray-300 transition bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>

                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="px-4 py-2 text-xs font-medium text-white transition bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default HistoricalDataTab;
