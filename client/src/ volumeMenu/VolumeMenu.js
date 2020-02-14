import React, { useEffect, useState } from "react";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";
import { Segment, Divider, Button } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import "./VolumeMenu.css";
import Volume from "./Volume";
import axios from "axios";

function VolumeMenu() {
  const [volumeInfo, setVolumeInfo] = useState();
  const [loading, setLoading] = useState(false);
  const [integrity, setIntegrity] = useState({ status: "verified" });

  useEffect(() => {
    axios.get("/volumes").then(res => {
      setVolumeInfo(res.data);
    });
  }, []);

  function verifyIntegrity() {
    setLoading(true);
    axios.get("/volumes/verify").then(res => {
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
