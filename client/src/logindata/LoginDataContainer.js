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

function LoginDataContainer() {
  const [loginData, setLoginData] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  useEffect(() => {
    axios.get("/logindata").then(res => {
      setLoginData(res.data);
    });
  }, []);

  return (
    <ContentWrapper>
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} />

      <MuiThemeProvider theme={theme}>
        <MaterialTable
          title={<Header as="h1">Login Data</Header>}
          columns={[
            {
              title: "Action URL",
              field: "action_url"
            },
            {
              title: "Username",
              field: "username_value"
            },
            {
              title: "Password (hex)",
              field: "password_value"
            },
            { title: "Preferred", field: "preferred", type: "numeric" },
            { title: "Times Used", field: "times_used", type: "numeric" },
            { title: "Created", field: "date_created" },
            {
              title: "Last Used",
              field: "date_last_used"
            }
          ]}
          data={loginData}
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

export default LoginDataContainer;
