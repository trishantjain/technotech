import React, { useEffect, useState, useRef } from 'react';
import '../App.css';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const defaultLocation = [28.6139, 77.2090];

function DashboardView() {
  const [readings, setReadings] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceMeta, setDeviceMeta] = useState([]);
  const [selectedMac, setSelectedMac] = useState('');
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState('gauges');
  const [activeFanBtns, setActiveFanBtns] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const mapRef = useRef();

  const latestReadingsByMac = {};
  readings.forEach(r => {
    if (!latestReadingsByMac[r.mac]) latestReadingsByMac[r.mac] = r;
  });

  const selectedDeviceMeta = deviceMeta.find(d => d.mac === selectedMac);
  const latestReading = readings.find(r => r.mac === selectedMac);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // 🔄 Auto-focus map on selected device
  useEffect(() => {
    if (mapRef.current && selectedMac) {
      const selectedDevice = deviceMeta.find(d => d.mac === selectedMac);
      const lat = parseFloat(selectedDevice?.latitude);
      const lon = parseFloat(selectedDevice?.longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        mapRef.current.flyTo([lat, lon], 15, { duration: 1.5 });
        console.log(`🔍 Flying to ${selectedMac} at [${lat}, ${lon}]`);
      }
    }
  }, [selectedMac, deviceMeta]);

  useEffect(() => {
    const iframe = document.querySelector('.camera-iframe');
    if (iframe) {
      iframe.style.transform = `scale(${zoom}) rotate(${rotation}deg)`;
    }
  }, [zoom, rotation]);

  const fetchData = async () => {
    try {
      const [readingsRes, devicesRes, deviceMetaRes] = await Promise.all([
        fetch('http://localhost:5000/api/readings'),
        fetch('http://localhost:5000/api/all-devices'),
        fetch('http://localhost:5000/api/devices-info')
      ]);
      const [readingsData, devicesData, metadata] = await Promise.all([
        readingsRes.json(),
        devicesRes.json(),
        deviceMetaRes.json()
      ]);
      setReadings(readingsData);
      setDevices(devicesData);
      setDeviceMeta(metadata);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const sendCommand = async (cmdToSend) => {
    if (!selectedMac || !cmdToSend) {
      setStatus('Please select a device and enter a command.');
      return;
    }
    try {
      const res = await fetch('http://localhost:5000/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: selectedMac, command: cmdToSend }),
      });
      const data = await res.json();
      setStatus(data.message);
    } catch (error) {
      console.error('Command error:', error);
      setStatus('Error sending command');
    }
  };

  const handleFanClick = (level) => {
    const isActive = activeFanBtns.includes(level);
    setActiveFanBtns(isActive ? activeFanBtns.filter(l => l !== level) : [...activeFanBtns, level]);
    sendCommand(`fan level ${level}`);
  };

  const handleOpenLock = () => {
    const pwd = window.prompt("Enter password to open lock:");
    if (pwd === 'admin123') sendCommand('open lock');
    else setStatus('Wrong password for opening lock!');
  };

  const handleResetLock = () => {
    const pwd = window.prompt("Enter password to reset lock:");
    if (pwd === 'admin123') {
      const newLock = window.prompt("Enter new lock value:");
      if (newLock && newLock.trim() !== '') {
        sendCommand(`reset lock ${newLock}`);
      } else {
        setStatus('New lock value cannot be empty!');
      }
    } else {
      setStatus('Wrong password for resetting lock!');
    }
  };

  const toggleFullscreen = () => {
    const iframe = document.querySelector('.camera-iframe');
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
    else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();
  };

  const zoomIn = () => setZoom(prev => Math.min(prev + 0.1, 2));
  const zoomOut = () => setZoom(prev => Math.max(prev - 0.1, 1));
  const rotateFeed = () => setRotation(prev => (prev + 90) % 360);

  const isAlarmActive = (reading) =>
    reading.fireAlarm || reading.waterLeakage || reading.waterLogging;

  const historicalData = readings
    .filter(r => r.mac === selectedMac)
    .slice(-15)
    .map(r => ({
      time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      insideTemperature: r.insideTemperature,
      outsideTemperature: r.outsideTemperature,
      humidity: r.humidity,
      inputVoltage: r.inputVoltage,
      outputVoltage: r.outputVoltage,
      batteryBackup: r.batteryBackup
    }));

  const alarmKeys = [
    {
      key: 'fireAlarm',
      Name: 'Fire Alarm'
    },
    {
      key: 'waterLogging',
      Name: 'Logging'
    },
    {
      key: 'waterLeakage',
      Name: 'Leakage'
    },
  ]

  const statusKeys = [
    {
      key: 'lockStatus',
      Name: "Lock"
    },
    {
      key: 'doorStatus',
      Name: "Door"
    },
    {
      key: 'fanFailBits',
      Name: "Password"
    },
  ]

  return (
    <div className="dashboard">
      <div className="panel">
        <h2 className="selected-heading">📟 Selected Device {selectedMac && <span>: {selectedMac}</span>}</h2>
        {latestReading && (
          <>
            <div className="tabs">
              <button className={activeTab === 'gauges' ? 'active' : ''} onClick={() => setActiveTab('gauges')}>Gauges</button>
              <button className={activeTab === 'status' ? 'active' : ''} onClick={() => setActiveTab('status')}>Status</button>
              <button className={activeTab === 'camera-feed' ? 'active' : ''} onClick={() => setActiveTab('camera-feed')}>Camera Feed</button>
              <button className={activeTab === 'snapshots' ? 'active' : ''} onClick={() => setActiveTab('snapshots')}>Snapshots</button>
            </div>

            {activeTab === 'gauges' && (
              <div className="gauges grid-3x3">
                <Gauge label="Inside Temp" value={latestReading.insideTemperature} max={100} color="#e63946" alarm={latestReading.insideTemperatureAlarm} />
                <Gauge label="Outside Temp" value={latestReading.outsideTemperature} max={100} color="#fca311" alarm={latestReading.outsideTemperatureAlarm} />
                <Gauge label="Humidity" value={latestReading.humidity} max={100} color="#1d3557" alarm={latestReading.humidityAlarm} />
                <Gauge label="Input Voltage" value={latestReading.inputVoltage} max={5} color="#06d6a0" alarm={latestReading.inputVoltageAlarm} />
                <Gauge label="Output Voltage" value={latestReading.outputVoltage} max={5} color="#118ab2" alarm={latestReading.outputVoltageAlarm} />
                <Gauge label="Battery (min)" value={latestReading.batteryBackup} max={120} color="#ffc107" alarm={latestReading.batteryBackupAlarm} />
              </div>
            )}

            {activeTab === 'status' && (
              <div className="fan-status">
                <div className="fan-status-line">
                  <h4>Fan Running Status</h4>
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="fan-light">
                      <div className={`fan-light-circle ${latestReading[`fan${i + 1}Status`] ? 'running' : 'stopped'}`} />
                      <div className="fan-label">F{i + 1}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'status' && (
                <div className="fan-status">
                  <div className="fan-status-line">
                    <h4>Fan Running Status</h4>
                    {[...Array(6)].map((_, i) => {
                      const statusVal = latestReading[`fan${i + 1}Status`]; // 0=off, 1=healthy, 2=faulty
                      console.log('statusVal', statusVal);

                      console.log("statusC")
                      let statusClass = 'off';
                      if (statusVal === 1) {
                        statusClass = 'running';  // green
                      } else if (statusVal === 2) {
                        statusClass = 'faulty';   // red
                      }
                      console.log(statusClass);

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
                        <div className={`alarm-led ${latestReading[alarm.key] ? 'active' : ''}`} />
                        <div className="alarm-label">{alarm.Name}</div>
                      </div>
                    ))}
                    {statusKeys.map((status, i) => {
                      if (status.key !== 'fanFailBits') {

                        return (
                          <div key={i} className="alarm-indicator">
                            <div className={`alarm-led ${latestReading[status.key] === 'OPEN' ? 'active' : ''}`} />
                            <div className="alarm-label">{status.Name}</div>
                          </div>
                        );
                      } else {
                        return (<div key={i} className="alarm-indicator">
                          <div className={`alarm-led ${latestReading[status.key] === 1 ? 'active' : ''}`} />
                          <div className="alarm-label">{status.Name}</div>
                        </div>);
                      }
                    })}
                  </div>

                  <div className="alarm-line">
                    <h4>HUPS</h4>
                    {['Mains', 'Rectfier', 'Inverter'].map((key, i) => (
                      <div key={i} className="alarm-indicator">
                        <div className={`alarm-led ${latestReading[key] ? 'active' : ''}`} />
                        <div className="alarm-label">{key.replace(/([A-Z])/g, ' $1')}</div>
                      </div>
                    ))}
                    {['O.Load', 'MPT', 'MOSFET'].map((key, i) => (
                      <div key={i} className="alarm-indicator">
                        <div className={`alarm-led ${latestReading[key] === 'OPEN' ? 'active' : ''}`} />
                        <div className="alarm-label">{key.replace('Status', '')}</div>
                      </div>
                    ))}
                  </div>

                  <h4>🛠 Commands</h4>
                  <div className="fan-power-buttons aligned">
                    {[1, 2, 3, 4, 5].map(level => (
                      <div key={level} className="fan-light">
                        <button className={`power-btn ${activeFanBtns.includes(level) ? 'active' : ''}`} onClick={() => handleFanClick(level)} />
                        <div className="fan-label">{level >= 1 && level <= 4 ? `FG ${level}` : 'LOAD'}</div>
                      </div>
                    ))}
                    <div className="fan-light">
                      <button className="lock-btn" onClick={handleOpenLock}>🔓</button>
                      <div className="fan-label">Lock</div>
                    </div>
                    <div className="fan-light">
                      <button className="lock-btn" onClick={handleResetLock}>🔐</button>
                      <div className="fan-label">Reset</div>
                    </div>
                    <div className="fan-light">
                      <button className="lock-btn" onClick={openPassword}>🔐</button>
                      <div className="fan-label">Open PWD</div>
                    </div>
                  ))}
                  <div className="fan-light">
                    <button className="lock-btn" onClick={handleOpenLock}>🔓</button>
                    <div className="fan-label">Lock</div>
                  </div>
                  <div className="fan-light">
                    <button className="lock-btn" onClick={handleResetLock}>🔐</button>
                    <div className="fan-label">Reset</div>
                  </div>
                </div>
                {status && <p>{status}</p>}
              </div>
            )}

            {activeTab === 'camera-feed' && (
              <div className="camera-feed-wrapper">
                <div className="camera-frame">
                  <iframe
                    className="camera-iframe"
                    src={selectedDeviceMeta?.ipCamera || ''}
                    allow="autoplay"
                    title="Live Camera"
                  />
                </div>
                <div className="camera-controls">
                  <button onClick={toggleFullscreen}>🔳 Fullscreen</button>
                  <button onClick={rotateFeed}>🔄 Rotate</button>
                  <button onClick={zoomIn}>➕ Zoom In</button>
                  <button onClick={zoomOut}>➖ Zoom Out</button>
                </div>
              </div>
            )}

            {activeTab === 'snapshots' && (
              <div className="camera-tab">
                <h4>🖼️ Last 15 Snapshots (Placeholder)</h4>
                <div className="snapshots-grid">
                  {[...Array(15)].map((_, i) => (
                    <img key={i} src={`https://via.placeholder.com/120x90?text=Img+${i + 1}`} alt={`snapshot-${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Panel 2: Chart */}
      <div className="panel">
        <h2>📈 Historical Data</h2>
        {selectedMac && historicalData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={historicalData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" interval={0} angle={-45} textAnchor="end" height={60} tick={{ fontSize: 10, fill: '#ccc' }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="insideTemperature" stroke="#ff4d4f" dot={false} isAnimationActive={true} name="insideTemp" />
              <Line type="monotone" dataKey="humidity" stroke="#1d3557" dot={false} isAnimationActive={true} />
              <Line type="monotone" dataKey="inputVoltage" stroke="#00b894" dot={false} isAnimationActive={true} name="I/P volt" />
              <Line type="monotone" dataKey="outputVoltage" stroke="#0984e3" dot={false} isAnimationActive={true} name="O/P volt" />
              <Line type="monotone" dataKey="batteryBackup" stroke="#ffc107" dot={false} isAnimationActive={true} name="Battery" />
              <Line type="monotone" dataKey="outsideTemperature" stroke="#ffa500" dot={false} isAnimationActive={true} name="outsideTemp" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p>Select a device to see its historical chart</p>
        )}
      </div>

      {/* Panel 3: Device Tiles */}
      <div className="panel device-list">
        <h2>🟢 Devices</h2>
        <div className="grid">
          {deviceMeta.map(device => {
            const mac = device.mac;
            const reading = readings.find(r => r.mac === mac);
            let colorClass = 'disconnected';

            if (reading && Date.now() - new Date(reading.timestamp).getTime() < 10000) {
              const hasStatusAlarm = isAlarmActive(reading);
              const hasGaugeAlarm =
                reading.insideTemperatureAlarm || reading.outsideTemperatureAlarm ||
                reading.humidityAlarm || reading.inputVoltageAlarm ||
                reading.outputVoltageAlarm || reading.batteryBackupAlarm;

              colorClass = hasStatusAlarm ? 'status-alarm'
                : hasGaugeAlarm ? 'gauge-alarm' : 'connected';
            }

            return (
              <div
                key={mac}
                className={`device-tile ${colorClass} ${selectedMac === mac ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedMac(mac);
                  const device = deviceMeta.find(d => d.mac === mac);
                  const lat = parseFloat(device?.latitude);
                  const lon = parseFloat(device?.longitude);
                  if (mapRef.current && !isNaN(lat) && !isNaN(lon)) {
                    mapRef.current.flyTo([lat, lon], 15, { duration: 1.5 });
                  }
                }}
              >
                {mac}
              </div>
            );
          })}
        </div>
      </div>
      {/* Panel 4: Map */}
      <div className="panel device-map">
        <h2>🗺️ Device Map</h2>
        <MapContainer
  center={defaultLocation}
  zoom={11}
  scrollWheelZoom={true}
  style={{ height: '100%', width: '100%' }}
  whenCreated={(mapInstance) => {
    mapRef.current = mapInstance;
  }}
>

          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {deviceMeta.map(device => {
            const mac = device.mac;
            const reading = latestReadingsByMac[mac];
            if (!reading) return null;

            const hasStatusAlarm = isAlarmActive(reading);
            const hasGaugeAlarm =
              reading.insideTemperatureAlarm || reading.outsideTemperatureAlarm ||
              reading.humidityAlarm || reading.inputVoltageAlarm ||
              reading.outputVoltageAlarm || reading.batteryBackupAlarm;

            let dotClass = 'disconnected';
            if (hasStatusAlarm) dotClass = 'status-alarm';
            else if (hasGaugeAlarm) dotClass = 'gauge-alarm';
            else dotClass = 'connected';

            const icon = L.divIcon({
              className: 'custom-marker',
              html: `<div class="marker-dot ${dotClass}"></div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });

            const lat = parseFloat(device.latitude);
            const lon = parseFloat(device.longitude);

            return (
              <Marker
                key={mac}
                position={[lat, lon]}
                icon={icon}
                eventHandlers={{ click: () => setSelectedMac(mac) }}
              >
                <Popup>{mac}<br />{device.block}, {device.panchayat}</Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

function Gauge({ label, value, max, color, alarm = false }) {
  return (
    <div className={`gauge-box small ${alarm ? 'alarm' : ''}`}>
      <CircularProgressbar
        value={value}
        maxValue={max}
        text={`${value}`}
        styles={buildStyles({ pathColor: color, textColor: '#fff', trailColor: '#333' })}
      />
      <div className="gauge-label">{label}</div>
    </div>
  );
}

export default DashboardView;
