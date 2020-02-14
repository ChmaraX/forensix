import React from "react";
import { Card } from "semantic-ui-react";
import { Link } from "react-router-dom";

function Volume(props) {
  return (
    <Link to="/dashboard" style={{ color: "black" }}>
      <Card
        className="volume-box"
        header={props.volumeInfo.location}
        meta={`SHA1: ${props.integrity.hash}`}
        description={
          <p style={{ marginTop: "10px" }}>
            <b>type:</b> {props.volumeInfo.file_system} <br />
            <b>mounted on:</b> {props.volumeInfo.mount_point} <br />
            <b>mount options:</b> {props.volumeInfo.mount_opts} <br />
            <span
              style={{
                color: props.integrity.status === "verified" ? "green" : "red"
              }}
            >
              <b>integrity:</b> {props.integrity.status}
            </span>
            <br />
          </p>
        }
      />
    </Link>
  );
}

export default Volume;
