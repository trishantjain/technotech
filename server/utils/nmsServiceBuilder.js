function buildService({
    description,
    serviceName,
    value,
    unit = "",
    status = "Info"
}) {
    return {
        description,
        serviceName,
        value,
        unit,
        status
    };
}

module.exports = {
    buildService
};