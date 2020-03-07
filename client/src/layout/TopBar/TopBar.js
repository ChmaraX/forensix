import React, { useState, useEffect } from "react";
import { Image, Icon, Loader, Dropdown } from "semantic-ui-react";
import "./TopBar.css";
import axios from "axios";
import { useSelector, useDispatch } from "react-redux";
import { logout } from "../../store/actions/auth";
import { storeVolumesInfo } from "../../store/actions/appData";

function TopBar() {
  const dispatch = useDispatch();
  const username = useSelector(state => state.authReducer.username);
  const volumesInfo = useSelector(state => state.appDataReducer.volumesInfo);
  const [status, setStatus] = useState(volumesInfo.status);
  const [fetching, setFetching] = useState(false);
  const [volume, setVolume] = useState(volumesInfo.volume);

  useEffect(() => {
    const token = localStorage.getItem("token");

    const config = {
      headers: { Authorization: `Bearer ${token}` }
    };

    if (!status) {
      setFetching(true);

      axios.get("/volumes/verify", config).then(res => {
        setStatus(res.data.status);
        dispatch(storeVolumesInfo({ status: res.data.status }));
        setFetching(false);
      });

      axios.get("/volumes", config).then(res => {
        setVolume(res.data);
        dispatch(storeVolumesInfo({ volume: res.data }));
      });
    }
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
        <Dropdown text={username}>
          <Dropdown.Menu>
            <Dropdown.Item text="Logout" onClick={() => dispatch(logout())} />
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
