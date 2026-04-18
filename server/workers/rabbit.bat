@echo off
REM Running rabbitmq files

echo Running Rabbit connection ...
start cmd /k nodemon "D:\TechnoTrendz\server\services\rabbit.js"

echo Running Alarm Computation worker...
start cmd /k nodemon "D:\TechnoTrendz\server\workers\alarmComputationWorker.js"

echo Running Alarm worker...
start cmd /k nodemon "D:\TechnoTrendz\server\workers\alarmLogWorker.js"

echo Running Log worker...
start cmd /k nodemon "D:\TechnoTrendz\server\workers\IncLogWorker.js"

echo Running Snapshot worker...
start cmd /k nodemon "D:\TechnoTrendz\server\workers\snapshotWorker.js"

echo All scripts executed.
exit
