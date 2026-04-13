import React, { useEffect, useState } from "react";
import '../../App.css'
import { API } from '../../config/api.js'

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

    const filteredDevices = devices.filter((dev) =>
        dev.mac.toLowerCase().includes(query.toLowerCase())
    );

    const [specificReading, setSpecificReading] = useState(null);


    useEffect(() => {
        fetch(`${api}/${API.deviceInfo}`)
            .then((res) => res.json())
            .then(setDevices)
            .catch((err) => console.error("Error fetching devices:", err));
    }, []);

    const fetchHistoricalData = async () => {
        if (!date || !time || !toTime || !selectedMac) {
            alert("Please select device, date, from time and to time.");
            return;
        }

        const fromDateTime = `${date}T${time.length === 5 ? time + ":00" : time}`;
        const toDateTime = `${date}T${toTime.length === 5 ? toTime + ":00" : toTime}`;

        const fromObj = new Date(fromDateTime);
        const toObj = new Date(toDateTime);
        const now = new Date();

        if (isNaN(fromObj.getTime()) || isNaN(toObj.getTime())) {
            alert("❌ Invalid date/time format");
            return;
        }

        if (fromObj > now || toObj > now) {
            alert("⚠️ Cannot select future time");
            return;
        }

        if (toObj < fromObj) {
            alert("⚠️ 'To' must be after 'From'");
            return;
        }

        setLoading(true);

        try {
            const formatLocalNoTz = (d) => {
                const pad = (n) => String(n).padStart(2, "0");
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            };

            const fromStr = formatLocalNoTz(fromObj);
            const toStr = formatLocalNoTz(toObj);

            console.log("Alarm-history:", selectedMac, fromStr, "->", toStr);
            const res = await fetch(
                `${api}/alarm-history?mac=${encodeURIComponent(selectedMac)}&from=${encodeURIComponent(fromDateTime)}&to=${encodeURIComponent(toDateTime)}`
            );
            const data = await res.json();

            console.log("Data: ", data);
            if (!res.ok)
                throw new Error(data.error || "Failed to fetch historical data");

            // const hourlyReadings = downsampleHourly(data.alarms);
            setAlarmEntries(Array.isArray(data.entries) ? data.entries : []);
            // setSpecificReading(data.atSelectedTime);
            // console.log("specific: ", specificReading)
        } catch (err) {
            alert(`❌ ${err?.stack}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="historical-data-tab">

            <div className="p-6 bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl">

                <div className="p-6 border border-gray-700 shadow-xl bg-gray-900/80 backdrop-blur-md rounded-2xl">

                    <h2 className="flex items-center gap-2 mb-5 text-xl font-semibold text-white">
                        📊 <span>Historical Alarm Viewer</span>
                    </h2>

                    <div className="flex flex-wrap items-end gap-4">

                        {/* Device Search */}
                        <div className="relative w-[220px]">
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setShowDropdown(true);
                                }}
                                onFocus={() => setShowDropdown(true)}
                                placeholder="Search Device..."
                                className="w-full px-3 py-2 text-black border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />

                            {showDropdown && (
                                <div className="absolute z-50 w-full mt-1 overflow-y-auto text-black bg-white border rounded-lg shadow-md max-h-60">
                                    {filteredDevices.length > 0 ? (
                                        filteredDevices.map((dev) => (
                                            <div
                                                key={dev.mac}
                                                onClick={() => {
                                                    setQuery(dev.mac);
                                                    setSelectedMac(dev.mac);
                                                    setShowDropdown(false);
                                                }}
                                                className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                                            >
                                                {dev.mac}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="px-3 py-2 text-gray-500">No results</div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Date */}
                        <div className="flex flex-col">
                            <label className="mb-1 text-sm text-white">Date</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="px-3 py-2 text-black border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* From */}
                        <div className="flex flex-col">
                            <label className="mb-1 text-sm text-white">From</label>
                            <input
                                type="time"
                                step="1"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                className="px-3 py-2 text-black border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* To */}
                        <div className="flex flex-col">
                            <label className="mb-1 text-sm text-white">To</label>
                            <input
                                type="time"
                                step="1"
                                value={toTime}
                                onChange={(e) => setToTime(e.target.value)}
                                className="px-3 py-2 text-black border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* Button */}
                        <button
                            onClick={fetchHistoricalData}
                            disabled={loading}
                            className={`px-6 py-2 rounded-lg text-white font-medium transition-all duration-200 shadow-md
        ${loading
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 active:scale-95"
                                }`}
                        >
                            🔍 {loading ? "Fetching..." : "Fetch"}
                        </button>

                    </div>
                </div>
            </div>

            {loading ? (
                <div className="loader">⏳ Loading data...</div>
            ) : (
                <>
                    <div className="mt-4">
                        <h3 className="flex items-center gap-2 mb-3 text-lg font-semibold text-white">
                            🧾 Alarm File
                        </h3>

                        {alarmEntries.length === 0 ? (
                            <p className="text-gray-400">No records found</p>
                        ) : (
                            <div className="overflow-x-auto bg-gray-900 border border-gray-700 shadow-lg rounded-xl">

                                <table className="min-w-full text-sm text-left text-gray-300">

                                    {/* Header */}
                                    <thead className="text-xs text-gray-200 uppercase bg-gray-800">
                                        <tr>
                                            <th className="px-4 py-3">Time</th>
                                            <th className="px-4 py-3">Name</th>
                                            <th className="px-4 py-3">Value</th>
                                        </tr>
                                    </thead>

                                    {/* Body */}
                                    <tbody className="divide-y divide-gray-700">
                                        {alarmEntries.map((row, idx) => (
                                            <tr
                                                key={idx}
                                                className="transition duration-150 hover:bg-gray-800"
                                            >
                                                <td className="px-4 py-2 whitespace-nowrap">
                                                    {new Date(row.timestamp).toLocaleString("en-IN")}
                                                </td>

                                                <td className="px-4 py-2 font-medium text-blue-400">
                                                    {row.name}
                                                </td>

                                                <td className="px-4 py-2 font-semibold text-white">
                                                    {row.value}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>

                                </table>
                            </div>
                        )}
                    </div>

                    {specificReading && (
                        <div className="gauge-status-block">
                            <h3>📍 Snapshot at Selected Time</h3>
                            <div className="snapshot-table">
                                <div className="snapshot-cell">
                                    🌡 Inside Temp: {specificReading.insideTemperature}°C
                                </div>
                                <div className="snapshot-cell">
                                    💧 Humidity: {specificReading.humidity}%
                                </div>
                                <div className="snapshot-cell">
                                    🌡 Outside Temp: {specificReading.outsideTemperature}°C
                                </div>
                                <div className="snapshot-cell">
                                    🔋 Input Voltage: {specificReading.inputVoltage}V
                                </div>
                                <div className="snapshot-cell">
                                    🔌 Output Voltage: {specificReading.outputVoltage}V
                                </div>
                                <div className="snapshot-cell">
                                    🔋 Battery Backup: {specificReading.batteryBackup} mins
                                </div>
                                <div className="snapshot-cell">
                                    🔥 Fire Alarm:{" "}
                                    {specificReading.fireAlarm ? "Active" : "Normal"}
                                </div>
                                <div className="snapshot-cell">
                                    🚪 Lock: {specificReading.lockStatus}
                                </div>
                                <div className="snapshot-cell">
                                    🚪 Door: {specificReading.doorStatus}
                                </div>
                                <div className="snapshot-cell">
                                    ⚙️ Fan Level:{" "}
                                    {specificReading.fanLevel1Running
                                        ? 1
                                        : specificReading.fanLevel2Running
                                            ? 2
                                            : specificReading.fanLevel3Running
                                                ? 3
                                                : "Off"}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>


    );
};

export default HistoricalDataTab;