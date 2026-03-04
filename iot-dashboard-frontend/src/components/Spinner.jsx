import React from "react";
import "../styles/spinner.css";

const Spinner = ({ size = 40 }) => {
  return (
    <div className="spinner-wrapper">
      <div
        className="custom-spinner"
        style={{ width: size, height: size }}
      ></div>
    </div>
  );
};

export default Spinner;