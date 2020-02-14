import React from "react";
import "./Login.css";
import { Segment, Divider, Button, Form, Input } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";

function Login() {
  return (
    <CenteredWrapper>
      <Segment raised inverted className="black-base">
        <div className="left-box">
          <Logo />
          <br />
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer
            convallis ex sit amet risus lobortis scelerisque.
          </p>
          <Divider horizontal inverted section>
            Don't have an account yet?
          </Divider>
          <Button inverted size="big">
            Sign Up
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
          <Button fluid size="big" type="submit" className="login-button">
            Sign In
          </Button>
        </Form>
      </Segment>
    </CenteredWrapper>
  );
}

export default Login;
