// added by vats
// A synchronous function to format the date and time.
export function getFormattedDateTime() {
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