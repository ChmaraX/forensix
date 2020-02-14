import React from "react";
import "./CenteredWrapper.css";

function CenteredWrapper(props) {
  return <div className="centered-wrapper">{props.children}</div>;
}

export default CenteredWrapper;
