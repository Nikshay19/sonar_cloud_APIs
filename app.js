require("dotenv").config();

const axios = require("axios").default;
const fs = require("fs");
const sodium = require("tweetsodium");

/**
  The following is the nomenclature used in this file
  Nikshay19 -> Name of the the github organisation name (get it from config)
  Calculator -> Name of the repo -> This is the team_id
  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  -> This is the admin's authToken -> get it from config

**/

// repo secrets needed for sonarcloud and github authorization are created
async function uploadTokenToRepoSecrets(arr, gitHubOrganisation, gitHubRepo) {
  for (const el of arr) {
    //Obtain the key from repo to generate a encrypted secret
    const { data: encKeyObject } = await axios.get(
      `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        },
      }
    );
    const encryptedValue = encryptTokenForRepoSecret(
      encKeyObject.key,
      el.value
    );

    //Post the encrypted secret to github repo secrets
    await axios.put(
      `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/actions/secrets/${el.token_name}`,
      {
        encrypted_value: encryptedValue,
        key_id: encKeyObject.key_id,
      },
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        },
      }
    );
  }
  return "upload success";
}

//
//Create a project in sonarcloud from github repo, by integrating the github repo to sonarcloud
async function linkTosonarCloud(
  sonarToken,
  gitHubOrganisation,
  repoName,
  sonarOrganisation,
  repoId
) {
  const projectCreateReponse = await axios({
    url: "https://sonarcloud.io/api/alm_integration/provision_projects",
    method: "POST",
    auth: {
      username: sonarToken,
      password: "", // Password is not needed
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: `installationKeys=${gitHubOrganisation}%2F${repoName}%7C${repoId}&organization=${sonarOrganisation}`,
  });

  console.log(projectCreateReponse.data);

  //trigger autoscan to get metrics
  //commenting for now - do not delete this, might be a need in future
  const triggerAutoScan = await axios.get(
    `https://sonarcloud.io/api/autoscan/eligibility?autoEnable=true&projectKey=${projectCreateReponse.data.projects[0].projectKey}`
  );
  console.log(triggerAutoScan.data);

  return projectCreateReponse;
}

async function pushBuildFile(
  path,
  gitHubOrganisation,
  repo,
  commitMessage,
  language
) {
  let content = fs.readFileSync(`${language}build.yml`, "base64");

  console.log(
    `path:${path} githubOrg:${gitHubOrganisation} repo name:${repo} commit message: ${commitMessage} fileContent: ${content} token:${process.env.GITHUB_ACCESS_TOKEN}`
  );

  console.log(
    `url87 ===> https://api.github.com/repos/${gitHubOrganisation}/${repo}/contents/${path}`
  );
  //push the appropriate build file to initiate project analyses by sonarcloud
  const response = await axios.put(
    `https://api.github.com/repos/${gitHubOrganisation}/${repo}/contents/${path}`,
    {
      owner: gitHubOrganisation,
      repo: repo,
      message: commitMessage,
      content: content,
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );
  return response;
}

async function pushSonarPropertyFile(
  path,
  gitHubOrganisation,
  repo,
  commitMessage,
  language
) {
  let content = fs.readFileSync("sonar-project.properties", "base64");

  //push the appropriate sonar property file file to initiate project analyses by sonarcloud
  const response = await axios.put(
    `https://api.github.com/repos/${gitHubOrganisation}/${repo}/contents/${path}`,
    {
      owner: gitHubOrganisation,
      repo: repo,
      message: commitMessage,
      content: content,
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );
  return response;
}

async function createSonarCloudProjectAndLinkToGitHub(
  sonarAuthToken,
  gitHubOrganisation,
  gitHubRepo,
  sonarOrganisation,
  language
) {
  await uploadTokenToRepoSecrets(
    [
      {
        value: sonarAuthToken,
        token_name: "SONAR_TOKEN",
      },
      {
        value: "1234rthjrthtr556",
        token_name: "git_repo_token",
      },
    ],
    gitHubOrganisation,
    gitHubRepo
  );

  await pushBuildFile(
    ".github/workflows/build.yml",
    gitHubOrganisation,
    gitHubRepo,
    "build",
    language
  );
  if (language === "javascript") {
    await pushSonarPropertyFile(
      "sonar-project.properties",
      gitHubOrganisation,
      gitHubRepo,
      "property file",
      language
    );
  }

  const { data } = await axios.get(
    `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}`,
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );

  // const { data: actions } = await axios.put(
  //   `https://api.github.com/orgs/${gitHubOrganisation}/actions/permissions/repositories/${data.id}`,
  //   {
  //     org: gitHubOrganisation,
  //     repository_id: data.id,
  //   },
  //   {
  //     headers: {
  //       Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
  //     },
  //   }
  // );
  // console.log(actions);
  const respData = await linkTosonarCloud(
    sonarAuthToken,
    gitHubOrganisation,
    gitHubRepo,
    sonarOrganisation,
    data.id
  );

  return respData;
}

//fetch project metrics once build and analyses is complete
async function fetchMetricsFromSonarCloud(projectKey, branch, sonarAuthToken) {
  const sonarCloudMetricMap = new Map();
  let sonarCloudMetricsObj = {};
  let recursive = true;
  let pageNumber = 1;
  const { data: response_metric_measures } = await axios.get(
    `https://sonarcloud.io/api/measures/component_tree?component=${projectKey}&branch=${branch}&metricKeys=bugs,code_smells,lines,vulnerabilities&additionalFields=metrics`,
    {
      auth: {
        username: sonarAuthToken,
        password: "", // Password is not needed
      },
    }
  );

  if (
    response_metric_measures &&
    response_metric_measures.baseComponent &&
    typeof response_metric_measures.baseComponent === "object" &&
    Object.keys(response_metric_measures.baseComponent).length > 0 &&
    response_metric_measures.baseComponent.measures &&
    Array.isArray(response_metric_measures.baseComponent.measures) &&
    response_metric_measures.baseComponent.measures.length > 0
  ) {
    for (const el of response_metric_measures.baseComponent.measures) {
      sonarCloudMetricMap.set(el.metric, el.value ? Number(el.value) : 0);
    }
  }

  while (recursive) {
    //timeout for 1s, in case sonar cloud rate limits the request
    console.log(">>> waiting for a second <<<");
    await timeout();
    const { data: response_severity_tags } = await axios.get(
      `https://sonarcloud.io/api/issues/search?additionalFields=_all,comments,languages,actionPlans,rules,transitions,actions,users&asc=true&branch=${branch}&componentKeys=${projectKey}&ps=500&types=CODE_SMELL,BUG,VULNERABILITY&p=${pageNumber}`,
      {
        auth: {
          username: sonarAuthToken,
          password: "", // Password is not needed
        },
      }
    );
    if (
      response_severity_tags.issues &&
      Array.isArray(response_severity_tags.issues) &&
      response_severity_tags.issues.length > 0
    ) {
      for (const el of response_severity_tags.issues) {
        let count = 0;
        sonarCloudMetricMap.has(el.severity)
          ? sonarCloudMetricMap.set(
              el.severity,
              sonarCloudMetricMap.get(el.severity) + 1
            )
          : sonarCloudMetricMap.set(el.severity, ++count);
      }
    } else {
      recursive = false;
    }
    ++pageNumber;
  }
  const sonarCloudMetricsIterator = sonarCloudMetricMap[Symbol.iterator]();

  if (sonarCloudMetricMap.size > 0) {
    for (const el of sonarCloudMetricsIterator) {
      sonarCloudMetricsObj[el[0]] = el[1];
    }
  }
  console.log(sonarCloudMetricsObj);
  return sonarCloudMetricsObj;
}

function encryptTokenForRepoSecret(key, value) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(key, "base64");

  const encryptedBytes = sodium.seal(messageBytes, keyBytes);

  const encrypted = Buffer.from(encryptedBytes).toString("base64");

  return encrypted;
}

async function getGithubMetrics(gitHubOrganisation, gitHubRepo) {
  const githubMetricsMap = new Map();
  const githubMetricsResponeArray = [];
  let githubMetricsResponeObj = {};
  const githubMetrics = await axios.get(
    `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/stats/contributors`,
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );
  if (githubMetrics.data) {
    for (const el of githubMetrics.data) {
      let totalCommit = 0;
      let deletedLines = 0;
      let addedLines = 0;
      if (el.weeks && el.weeks.length > 0) {
        for (const week of el.weeks) {
          deletedLines += week.d;
          addedLines += week.a;
        }
      }
      totalCommit = el.total;
      if (githubMetricsMap.has(el.author.login)) {
        githubMetricsMap.set(
          `${el.author.login}_deletedLines`,
          githubMetricsMap.get(`${el.author.login}_deletedLines`) + deletedLines
        );
        githubMetricsMap.set(
          `${el.author.login}_addedLines`,
          githubMetricsMap.get(`${el.author.login}_addedLines`) + addedLines
        );
        githubMetricsMap.set(
          `${el.author.login}_totalCommit`,
          githubMetricsMap.get(`${el.author.login}_totalCommit`) + totalCommit
        );
      } else {
        githubMetricsMap.set(el.author.login, "author");
        githubMetricsMap.set(`${el.author.login}_deletedLines`, deletedLines);
        githubMetricsMap.set(`${el.author.login}_addedLines`, addedLines);
        githubMetricsMap.set(`${el.author.login}_totalCommit`, totalCommit);
      }
    }
    const gitHubMetricsIterator = githubMetricsMap[Symbol.iterator]();
    for (const el of gitHubMetricsIterator) {
      if (el[1] === "author") {
        githubMetricsResponeObj.authorName = el[0];
      } else {
        githubMetricsResponeObj[el[0].split("_")[1]] = el[1];
      }
      if (Object.keys(githubMetricsResponeObj).length === 4) {
        githubMetricsResponeArray.push(githubMetricsResponeObj);
        githubMetricsResponeObj = {};
      }
    }
  }
  return githubMetricsResponeArray;
}

async function fetchMetricsFromGitHub(gitHubOrganisation, gitHubRepo) {
  const obj = {};
  const githubMetrics = await getGithubMetrics(gitHubOrganisation, gitHubRepo);

  obj.githubMetrics = githubMetrics;

  const languagesUsed = await axios.get(
    `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/languages`,
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );

  obj.languagesUsed = languagesUsed.data;
  return obj;
}

async function initiateSonarcloudGithubIntegration(
  sonarAuthToken,
  gitHubOrganisation,
  gitHubRepo,
  sonarOrganisation,
  language,
  branch
) {
  const obj = {};
  const { data: sonarCloudResponse } =
    await createSonarCloudProjectAndLinkToGitHub(
      sonarAuthToken,
      gitHubOrganisation,
      gitHubRepo,
      sonarOrganisation,
      language
    );
  if (
    sonarCloudResponse &&
    sonarCloudResponse.projects[0] &&
    sonarCloudResponse.projects[0].projectKey
  ) {
    const sonarcloudMetrics = await fetchMetricsFromSonarCloud(
      sonarCloudResponse.projects[0].projectKey,
      branch,
      sonarAuthToken
    );
    obj.sonarcloudMetrics = sonarcloudMetrics;
  }

  console.log(">>>>>>> fetching github metrics <<<<<<<<<<");

  const githubMetrics = await fetchMetricsFromGitHub(
    gitHubOrganisation,
    gitHubRepo
  );

  obj.githubMetrics = githubMetrics;

  return obj;
}

initiateSonarcloudGithubIntegration(
  "5f823c56a6fb3dad72af67881b48e2997ba46b33",
  "neojarvis-testing",
  "b733dda5-4189-4a0a-9310-98cb0433b39d",
  "neojarvis-testing",
  "java",
  "main"
)
  .then((res) => {
    console.log(res);
  })
  .catch((err) => {
    console.log(err.response);
    console.log(err.response ? err.response.data : err);
  });

function timeout() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("proceed");
    }, 1000);
  });
}
