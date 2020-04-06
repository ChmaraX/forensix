import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Dropdown, Icon, Image, Loader } from "semantic-ui-react";
import axios from "../../axios-api";
import { storeVolumesInfo } from "../../store/actions/appData";
import { logout } from "../../store/actions/auth";
import "./TopBar.css";

function TopBar() {
  const dispatch = useDispatch();
  const username = useSelector((state) => state.authReducer.username);
  const volumesInfo = useSelector((state) => state.appDataReducer.volumesInfo);
  const [status, setStatus] = useState(volumesInfo.status);
  const [fetching, setFetching] = useState(true);
  const [volume, setVolume] = useState(volumesInfo.volume);

  const token = localStorage.getItem("token");

  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };

  useEffect(() => {
    axios.get("/volumes/verify", config).then((res) => {
      setStatus(res.data.status);
      dispatch(storeVolumesInfo({ status: res.data.status }));
      setFetching(false);
    });

    if (!volumesInfo.volume) {
      axios.get("/volumes", config).then((res) => {
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
