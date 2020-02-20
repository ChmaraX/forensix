import React from "react";
import MaterialTable from "material-table";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header } from "semantic-ui-react";

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

function DownloadsTable(props) {
  return (
    <MuiThemeProvider theme={theme}>
      <MaterialTable
        title={<Header as="h1">Downloads</Header>}
        columns={[
          {
            title: "Target Path",
            field: "target_path"
          },
          {
            title: "Tab URL",
            field: "tab_url"
          },
          {
            title: "Mime Type",
            field: "mime_type"
          },
          { title: "Total Bytes", field: "total_bytes", type: "numeric" },
          { title: "State", field: "state" },
          {
            title: "Danger Type",
            field: "danger_type"
          },
          { title: "Interrupt reason", field: "interrupt_reason" },
          { title: "Start Time", field: "start_time" },
          { title: "End Time", field: "end_time" }
        ]}
        data={props.downloads}
        actions={[
          {
            icon: "save",
            tooltip: "Mark as evidence",
            onClick: (event, rowData) =>
              props.setShowModal({
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
  );
}

export default DownloadsTable;
