import React, { useEffect, useState } from "react";
import axios from "axios";
import MaterialTable from "material-table";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header, Modal, Button, Icon } from "semantic-ui-react";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "rgb(111, 156, 235)"
    },
    secondary: {
      main: "rgb(111, 156, 235)"
    }
  }
});

function HistoryContainer() {
  const [history, setHistory] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });
  function fetchData() {
    let history = axios.get("/history").then(res => {
      setHistory(res.data);
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
      {SaveEvidenceModal()}
      <MuiThemeProvider theme={theme}>
        <MaterialTable
          title={<Header as="h1">History</Header>}
          columns={[
            {
              title: "Title",
              field: "title"
            },
            {
              title: "URL",
              field: "url"
            },
            { title: "# Visits", field: "visit_count", type: "numeric" },
            { title: "# Typed", field: "typed_count", type: "numeric" },
            { title: "Last Visit Time", field: "last_visit_time" },
            {
              title: "Visit Duration (sec.)",
              field: "visit_duration",
              type: "numeric"
            },
            { title: "Transition", field: "transition" }
          ]}
          data={history}
          actions={[
            {
              icon: "save",
              tooltip: "Mark as evidence",
              onClick: (event, rowData) =>
                setShowModal({
                  show: true,
                  data: rowData
                })
            }
          ]}
          options={{
            selection: true,
            exportButton: true,
            tableLayout: "fixed",
            cellStyle: { overflow: "hidden" },
            searchFieldAlignment: "right",
            searchFieldStyle: { width: "500px" },
            pageSize: 5
          }}
        />
      </MuiThemeProvider>
    </ContentWrapper>
  );
}

export default HistoryContainer;
