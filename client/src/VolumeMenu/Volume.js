import React, { useEffect } from "react";
import { Card } from "semantic-ui-react";

function Volume(props) {
  return (
    <Card
      className="volume-box"
      header={props.volumeInfo.location}
      meta={`SHA1: ${props.volumeInfo.hash}`}
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
  );
}

export default Volume;
