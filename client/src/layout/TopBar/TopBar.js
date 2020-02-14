import React, { useState, useEffect } from "react";
import { Image, Icon, Loader, Dropdown } from "semantic-ui-react";
import "./TopBar.css";
import axios from "axios";
import { useHistory } from "react-router-dom";

function TopBar() {
  const [status, setStatus] = useState();
  const [fetching, setFetching] = useState(true);
  const [volume, setVolume] = useState();
  const history = useHistory();

  useEffect(() => {
    axios.get("/volumes/verify").then(res => {
      setStatus(res.data.status);
      setFetching(false);
    });

    axios.get("/volumes").then(res => {
      setVolume(res.data);
    });
  }, []);

  return (
    <div className="top-bar">
      <div>
        <p>
          <Icon name="disk" />
          <b>Currently investigating: </b> {volume?.location} <br />
          <b>Integrity: </b>
          {fetching ? (
            <Loader active inline size="mini" inverted />
          ) : (
            <span
              style={{ color: status === "verified" ? "lightgreen" : "red" }}
            >
              {status}{" "}
              <Icon name={status === "verified" ? "check circle" : "close"} />
            </span>
          )}
        </p>
      </div>
      <div className="avatar">
        <Dropdown text="Adam Chmara">
          <Dropdown.Menu>
            <Dropdown.Item text="Logout" onClick={() => history.push("/")} />
          </Dropdown.Menu>
        </Dropdown>
        <Image
          src="https://react.semantic-ui.com/images/avatar/small/elliot.jpg"
          avatar
          circular
          className="border"
        />
      </div>
    </div>
  );
}

export default TopBar;
