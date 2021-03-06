import React, { useEffect, useState } from "react";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";
import { Segment, Divider, Button } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import "./VolumeMenu.css";
import Volume from "./Volume";
import axios from "../axios-api";

function VolumeMenu() {
  const [volumeInfo, setVolumeInfo] = useState();
  const [loading, setLoading] = useState(false);
  const [integrity, setIntegrity] = useState({ status: "verified" });

  const token = localStorage.getItem("token");

  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };

  useEffect(() => {
    axios.get("/volumes", config).then(res => {
      setVolumeInfo(res.data);
    });
    verifyIntegrity();
  }, []);

  function verifyIntegrity() {
    setLoading(true);
    axios.get("/volumes/verify", config).then(res => {
      setLoading(false);
      setIntegrity(res.data);
    });
  }

  return (
    <CenteredWrapper>
      <Segment raised className="volumes-wrapper">
        <Logo />
        <Divider horizontal section>
          Select mounted volume
        </Divider>
        <Button loading={loading} onClick={verifyIntegrity}>
          Verify integrity
        </Button>
        {volumeInfo ? (
          <Volume volumeInfo={volumeInfo} integrity={integrity} />
        ) : (
          <p>No volumes available</p>
        )}
      </Segment>
    </CenteredWrapper>
  );
}

export default VolumeMenu;
