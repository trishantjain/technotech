const net = require("net");

const AWS_HOST = "98.88.250.83";
const AWS_PORT = 4000;

net.createServer((deviceSocket) => {
  console.log("✅ Device connected:", deviceSocket.remoteAddress);

  const awsSocket = net.createConnection(
    { host: AWS_HOST, port: AWS_PORT },
    () => {
      console.log("➡️ Connected to AWS");
    }
  );

  // Device → AWS
  deviceSocket.pipe(awsSocket);

  // AWS → Device (optional but safe)
  awsSocket.pipe(deviceSocket);

  deviceSocket.on("close", () => {
    awsSocket.end();
    console.log("❌ Device disconnected");
  });

  awsSocket.on("close", () => {
    deviceSocket.end();
    console.log("❌ AWS connection closed");
  });

  deviceSocket.on("error", () => {});
  awsSocket.on("error", () => {});
}).listen(4000, "0.0.0.0", () => {
  console.log("🚀 Relay listening on port 4000");
});
