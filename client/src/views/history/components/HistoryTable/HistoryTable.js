import { createMuiTheme, MuiThemeProvider } from "@material-ui/core";
import MaterialTable from "material-table";
import React, { useState } from "react";
import { Button, Header, Modal } from "semantic-ui-react";
import axios from "../../../../axios-api";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "rgb(111, 156, 235)",
    },
    secondary: {
      main: "rgb(111, 156, 235)",
    },
  },
});

function HistoryTable(props) {
  const [securityModal, setSecurityModal] = useState({ show: false, data: {} });

  const getSecurityCheck = (url) => {
    const token = localStorage.getItem("token");

    const config = {
      headers: { Authorization: `Bearer ${token}` },
      params: { url },
    };
    axios.get("/history/check", config).then((res) => {
      setSecurityModal({ show: true, data: res.data });
      console.log(res.data);
    });
  };

  const secModal = (
    <Modal
      open={securityModal.show}
      onClose={() => setSecurityModal({ show: false, data: {} })}
      size="tiny"
      closeIcon
    >
      <Header
        icon="lock"
        content={`Security check results for ${securityModal?.data?.site?.domain}`}
        subheader={`Scanned in ${securityModal?.data?.scan?.duration}s`}
      />
      <Modal.Content>
        <p>
          <b>Hosting:</b> {securityModal?.data?.site?.hosting?.[0]}
        </p>
        <p>
          <b>IPs:</b>{" "}
          {securityModal?.data?.site?.ip?.map((ip) => (
            <p>{ip}</p>
          ))}
        </p>
        <p>
          <b>TLS cert. expires:</b> {securityModal?.data?.tls?.cert_expires}
        </p>
        <p>
          <b>Servers:</b>{" "}
          {securityModal?.data?.software?.server?.map((server) => (
            <p>
              {server.name} / {server.version}
            </p>
          ))}
        </p>
        <h3>Ratings:</h3>{" "}
        <p>
          <b>TLS:</b> {securityModal?.data?.ratings?.tls?.rating}
        </p>
        <p>
          <b>Total:</b> {securityModal?.data?.ratings?.total?.rating}
        </p>
        <p>
          <b>Domain:</b> {securityModal?.data?.ratings?.domain?.rating}
        </p>
        <p>
          <b>Security:</b> {securityModal?.data?.ratings?.security?.rating}
        </p>
      </Modal.Content>
    </Modal>
  );

  return (
    <MuiThemeProvider theme={theme}>
      {secModal}
      <MaterialTable
        title={<Header as="h1">History</Header>}
        columns={[
          {
            title: "Title",
            field: "title",
          },
          {
            title: "URL",
            field: "url",
          },
          { title: "# Visits", field: "visit_count", type: "numeric" },
          { title: "# Typed", field: "typed_count", type: "numeric" },
          { title: "Last Visit Time", field: "last_visit_time" },
          {
            title: "Visit Duration (sec.)",
            field: "visit_duration",
            type: "numeric",
          },
          { title: "Transition", field: "transition" },
          {
            title: "Action",
            field: "url",
            render: (rowData) => {
              return (
                <Button
                  onClick={() => getSecurityCheck(rowData?.url)}
                  size="tiny"
                >
                  Security Check
                </Button>
              );
            },
          },
        ]}
        data={props.history || []}
        actions={[
          {
            icon: "save",
            tooltip: "Mark as evidence",
            onClick: (event, rowData) =>
              props.setShowModal({
                show: true,
                data: rowData,
              }),
          },
        ]}
        options={{
          selection: true,
          exportButton: true,
          tableLayout: "auto",
          cellStyle: { overflow: "hidden" },
          searchFieldAlignment: "right",
          searchFieldStyle: { width: "500px" },
          pageSize: 5,
        }}
      />
    </MuiThemeProvider>
  );
}

export default HistoryTable;
