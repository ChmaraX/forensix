import React from "react";
import "./Login.css";
import { Segment, Divider, Button, Form, Input } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";
import { Link } from "react-router-dom";

function Login() {
  return (
    <CenteredWrapper>
      <Segment raised inverted className="black-base">
        <div className="left-box">
          <Logo />
          <br />
          <p>
            Bachelor thesis project by Adam Chmara <br />
            Slovak University of Technology in Bratislava <br />
            Faculty of Informatics and Information Technologies
          </p>
          <Divider horizontal inverted section>
            Don't have an account yet?
          </Divider>
          <Button inverted size="big">
            Click to login
          </Button>
        </div>
      </Segment>
      <Segment raised className="form-panel">
        <h1>Sign In</h1>
        <br />
        <Form>
          <Form.Field>
            <label>Username</label>
            <Input icon="user" placeholder="Username" />
          </Form.Field>
          <Form.Field>
            <label>Password</label>
            <Input icon="key" placeholder="******" />
          </Form.Field>
          <br />
          <Link to="/volumes">
            <Button fluid size="big" type="submit" className="login-button">
              Sign In
            </Button>
          </Link>
        </Form>
      </Segment>
    </CenteredWrapper>
  );
}

export default Login;
