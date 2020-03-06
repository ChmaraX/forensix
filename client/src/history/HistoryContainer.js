import React, { useEffect, useState } from "react";
import axios from "axios";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import { Grid } from "semantic-ui-react";
import BrowsingActivty from "../dashboard/components/BrowsingActivity/BrowsingActivity";
import HistoryTable from "./components/HistoryTable/HistoryTable";
import AvgVisitChart from "./components/AvgVisitChart/AvgVisitChart";
import SaveEvidenceModal from "../common/SaveEvidenceModal/SaveEvidenceModal";

function HistoryContainer() {
  const [history, setHistory] = useState();
  const [bActivity, setbActivity] = useState();
  const [avgDurations, setAvgDurations] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  function fetchData() {
    const token = localStorage.getItem("token");

    const config = {
      headers: { Authorization: `Bearer ${token}` }
    };

    let history = axios.get("/history", config).then(res => {
      setHistory(res.data);
    });

    let avgDurations = axios.get("/history/avg", config).then(res => {
      setAvgDurations(res.data);
    });

    let bActivity = axios.get("/history/activity", config).then(res => {
      setbActivity(res.data);
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

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
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} />
      <HistoryTable history={history} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default HistoryContainer;
