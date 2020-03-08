import React from "react";
import { Table, Segment, Header, Button, Image } from "semantic-ui-react";
import { withRouter } from "react-router-dom";

function UserActivity(props) {
  return (
    <Segment padded raised color="blue">
      <Header
        as="h1"
        content="Investigators Activity"
        subheader="last actions by all investigators on this volume"
        style={{ display: "inline-block" }}
      />
      <Button
        primary
        onClick={() => props.history.push("/database")}
        style={{ float: "right" }}
      >
        Show
      </Button>
      <Table celled fixed>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell width={4}>Name</Table.HeaderCell>
            <Table.HeaderCell>Created At</Table.HeaderCell>
            <Table.HeaderCell>Description</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {props.evidences.map(
            ({ reporter, fullname, createdAt, description, data }) => (
              <Table.Row key={reporter}>
                <Table.Cell>
                  <Header as="h4" image>
                    <Image
                      src={
                        "https://react.semantic-ui.com/images/avatar/small/elliot.jpg"
                      }
                      rounded
                      size="mini"
                    />
                    <Header.Content>
                      {fullname}
                      <Header.Subheader>Investigator</Header.Subheader>
                    </Header.Content>
                  </Header>
                </Table.Cell>
                <Table.Cell>{new Date(createdAt).toDateString()}</Table.Cell>
                <Table.Cell>{description}</Table.Cell>
              </Table.Row>
            )
          )}
        </Table.Body>
      </Table>
    </Segment>
  );
}

export default withRouter(UserActivity);
