import React, { useEffect, useState } from "react";
import axios from "axios";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import { Header, Modal, Button, Icon, Grid } from "semantic-ui-react";
import BrowsingActivty from "../dashboard/components/BrowsingActivity/BrowsingActivity";
import HistoryTable from "./components/HistoryTable/HistoryTable";
import AvgVisitChart from "./components/AvgVisitChart/AvgVisitChart";

function HistoryContainer() {
  const [history, setHistory] = useState();
  const [bActivity, setbActivity] = useState();
  const [avgDurations, setAvgDurations] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  function fetchData() {
    let history = axios.get("/history").then(res => {
      setHistory(res.data);
    });

    let avgDurations = axios.get("/history/avg").then(res => {
      setAvgDurations(res.data);
    });

    let bActivity = axios.get("/history/activity").then(res => {
      setbActivity(res.data);
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

  function saveEvidence() {
    //todo hook to db
    setShowModal({ show: false, data: {} });
  }

  const SaveEvidenceModal = () => (
    <Modal
      open={showModal.show}
      onClose={() => setShowModal({ show: false, data: {} })}
      basic
      size="small"
    >
      <Header
        icon="archive"
        content="Save selected history records as potential evidence?"
      />
      <Modal.Content>
        <p>
          Selected records will be stored in shared database with other
          investigators.
        </p>
      </Modal.Content>
      <Modal.Actions>
        <Button
          onClick={() => setShowModal({ show: false, data: {} })}
          basic
          color="red"
          inverted
        >
          <Icon name="remove" /> No
        </Button>
        <Button onClick={() => saveEvidence()} color="green" inverted>
          <Icon name="checkmark" /> Yes
        </Button>
      </Modal.Actions>
    </Modal>
  );

  return (
    <ContentWrapper>
      <Grid columns="equal" stretched style={{ paddingBottom: "30px" }}>
        <Grid.Row>
          <Grid.Column>
            <AvgVisitChart avgDurations={avgDurations} />
          </Grid.Column>
          <Grid.Column>
            <BrowsingActivty bActivity={bActivity} onlyHeatmap={true} />
          </Grid.Column>
        </Grid.Row>
      </Grid>
      {SaveEvidenceModal()}
      <HistoryTable history={history} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default HistoryContainer;
