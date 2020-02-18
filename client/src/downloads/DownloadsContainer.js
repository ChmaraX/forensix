import React, { useEffect, useState } from "react";
import axios from "axios";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import DownloadsTable from "./components/DownloadsTable";
import SaveEvidenceModal from "../common/SaveEvidenceModal/SaveEvidenceModal";

function DownloadsContainer() {
  const [downloads, setDownloads] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  function fetchData() {
    let downloads = axios.get("/history/downloads").then(res => {
      setDownloads(res.data);
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <ContentWrapper>
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} />
      <DownloadsTable downloads={downloads} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default DownloadsContainer;
