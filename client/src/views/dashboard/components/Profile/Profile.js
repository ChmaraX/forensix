import React, { useState } from "react";
import {
  Button,
  Flag,
  Grid,
  Header,
  Icon,
  Image,
  List,
  Placeholder,
  Popup,
  Segment,
} from "semantic-ui-react";
import "./Profile.css";

const PlaceholderLine = () => (
  <Placeholder>
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
  </Placeholder>
);

const PlaceholderImage = () => (
  <Placeholder style={{ height: 150, width: 150 }}>
    <Placeholder.Image />
  </Placeholder>
);

const Avatar = (avatar) => (
  <Image
    circular
    style={{
      maxHeight: "150px",
    }}
    src={`data:image/png;base64, ${avatar}`}
  />
);

const EstimatedHeader = () => (
  <Header
    as="h1"
    content={
      <span>
        Profile <small style={{ color: "grey" }}>(estimated)</small>{" "}
        <Popup
          content="Estimation based on browsing history and login data."
          trigger={<Icon link name="help circle" size="small" color="grey" />}
        />
      </span>
    }
    style={{ display: "inline-block" }}
  />
);

const AccountsHeader = () => (
  <Header
    as="h1"
    content={
      <span>
        Accounts{" "}
        <Popup
          content="Existing user accounts used in Chrome (from Preferences file)."
          trigger={<Icon link name="help circle" size="small" color="grey" />}
        />
      </span>
    }
    style={{ display: "inline-block" }}
  />
);

const EstimatedContent = (profile) => (
  <div className="content">
    <Header subheader>{profile.fullname}</Header>
    <p className="left">
      <b>gender:</b>{" "}
      {profile.birthday.gender === 1
        ? "male"
        : profile.birthday.gender === 2
        ? "female"
        : "unknown"}{" "}
      <Icon
        title="test"
        name={
          profile.birthday.gender === 1
            ? "man"
            : profile.birthday.gender === 2
            ? "woman"
            : "dont"
        }
        color="blue"
      />
      <br />
      <b>nation:</b> {profile.nation.country.substring(0, 15)}{" "}
      <Flag name={profile.nation.tld} /> <br />
      <b>birthday:</b> {profile.birthday.birthyear || "unknown"} <br />
    </p>
    <p className="right">
      <b>address:</b> {profile.probableAddress || "unknown"}
      <br />
      <b>city:</b> {profile.probableCity || "unknown"} <br />
      <b>phone:</b> {profile.phone || "unknown"} <br />
    </p>
  </div>
);

const AccountContent = (accounts) =>
  accounts.length < 1 ? (
    <p>No accounts found.</p>
  ) : (
    <List style={{ overflowY: "scroll" }}>
      {accounts.map((acc, i) => (
        <List.Item key={i}>
          <Image avatar src={acc.picture_url} />
          <List.Content>
            <List.Header as="a">{acc.full_name}</List.Header>
            <List.Description>
              <p className="left">
                <b>email:</b> {acc.email} <br />
                <b>locale:</b> {acc.locale} <Flag name={acc.locale} /> <br />
              </p>
              <p className="right">
                <b>adv. protection:</b>{" "}
                {acc.is_under_advanced_protection.toString()} <br />
                <b>child account:</b> {acc.is_child_account.toString()} <br />
              </p>
            </List.Description>
          </List.Content>
        </List.Item>
      ))}
    </List>
  );

function Profile(props) {
  const [showAccounts, setShowAccounts] = useState(false);

  return (
    <Segment className="profile" padded raised>
      {showAccounts ? AccountsHeader() : EstimatedHeader()}
      <Button
        onClick={() => setShowAccounts(!showAccounts)}
        primary
        size="tiny"
        style={{ float: "right" }}
      >
        {showAccounts ? "Show Profile" : "Show Accounts"}
      </Button>
      {showAccounts ? (
        !props.accounts ? (
          PlaceholderLine()
        ) : (
          AccountContent(props.accounts || [])
        )
      ) : (
        <Grid>
          <Grid.Row>
            <Grid.Column width={5}>
              {!props.profile
                ? PlaceholderImage()
                : Avatar(props.profile?.avatars[0])}
            </Grid.Column>
            <Grid.Column width={11}>
              {!props.profile
                ? PlaceholderLine()
                : EstimatedContent(props.profile)}
            </Grid.Column>
          </Grid.Row>
        </Grid>
      )}
    </Segment>
  );
}

export default Profile;
