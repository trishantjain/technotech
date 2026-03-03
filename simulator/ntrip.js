const net = require("net");

const HOST = "127.0.0.1";
const PORT = 2101;
const MOUNTPOINT = "RTCM3EPH";

const client = new net.Socket();

client.connect(PORT, HOST, () => {
  console.log("Connected to caster");

  const request =
    `GET /${MOUNTPOINT} HTTP/1.0\r\n` +
    `User-Agent: NTRIP MyClient/1.0\r\n` +
    `Accept: */*\r\n` +
    `Connection: close\r\n\r\n`;

  client.write(request);
});

client.on("data", (data) => {
  console.log("Received RTCM bytes:", data);

  const bufStr = data.toString('hex').match(/.{1,2}/g).join(' ');

  console.log("buffer string: ", bufStr, "\n");
  // 👉 here you would forward to GNSS / file
});

client.on("error", console.error);
client.on("close", () => console.log("Disconnected"));