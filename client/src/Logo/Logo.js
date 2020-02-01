import React from "react";

const size = props => {
  switch (props.size) {
    case "small":
      return "20px";
    case "medium":
      return "40px";
    case "large":
      return "60px";
    default:
      return "40px";
  }
};

function Logo(props) {
  return (
    <h1 style={{ fontSize: `${size(props)}` }}>
      Forensi<span style={{ color: "#306bac" }}>X</span>
    </h1>
  );
}

export default Logo;
