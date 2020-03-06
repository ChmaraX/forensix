import React, { useState, useEffect } from "react";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import SaveEvidenceModal from "../common/SaveEvidenceModal/SaveEvidenceModal";
import MaterialTable from "material-table";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header } from "semantic-ui-react";
import axios from "axios";

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

function BookmarksContainer() {
  const [bookmarksData, setBookmarksData] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  useEffect(() => {
    axios.get("/bookmarks").then(res => {
      setBookmarksData(res.data);
    });
  }, []);

  return (
    <ContentWrapper>
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} />

      <MuiThemeProvider theme={theme}>
        <MaterialTable
          title={<Header as="h1">Bookmarks</Header>}
          columns={[
            {
              title: "Name",
              field: "name"
            },
            {
              title: "URL",
              field: "url"
            },
            {
              title: "Date Added",
              field: "date_added"
            },
            {
              title: "Last Visited",
              field: "last_visited_desktop"
            }
          ]}
          data={bookmarksData}
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
            tableLayout: "auto",
            cellStyle: { overflow: "hidden" },
            searchFieldAlignment: "right",
            searchFieldStyle: { width: "500px" },
            pageSize: 10
          }}
        />
      </MuiThemeProvider>
    </ContentWrapper>
  );
}

export default BookmarksContainer;
