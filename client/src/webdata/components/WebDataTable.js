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

function WebDataTable(props) {
  return (
    <MuiThemeProvider theme={theme}>
      <MaterialTable
        title={<Header as="h1">Autofills</Header>}
        columns={[
          {
            title: "Element Name",
            field: "name"
          },
          {
            title: "Element Value",
            field: "value"
          },
          {
            title: "Date Created",
            field: "date_created"
          },
          { title: "Last Used", field: "date_last_used" },
          { title: "Count", field: "count", type: "numeric" }
        ]}
        data={props.autofills}
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

export default WebDataTable;
