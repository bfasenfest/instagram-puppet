#! /usr/bin/env node

var fs = require("fs-extra");
var request = require("request");
var now = require("performance-now");
var chalk = require("chalk");
var clear = require("clear");
var ora = require("ora");
var figlet = require("figlet");
var inquirer = require("inquirer");
const puppeteer = require("puppeteer");

var itemsBeingProcessed = 0;
var fileQueue = [];
var maxItems = 10;
var counter = 0;
var responses = {};

var status = {};

var t0 = now(),
  t1 = 0;

var outputFilename = "./crawled_media.json";

clear();
console.log(
  chalk.red(
    figlet.textSync("Insta Downloader", { horizontalLayout: "default" })
  )
);

getLocations();

function getLocations(callback) {
  var questions = [
    {
      name: "locs",
      type: "input",
      default: "485819985122652",
      message: "Enter locations seperated by commas",
      validate: function(value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter a location";
        }
      }
    }
  ];

  inquirer.prompt(questions).then(getDir);
}

function getDir(answers) {
  let arr = answers.locs.split(",");
  responses.locs = [];

  arr.forEach((loc, index) => {
    loc = loc.trim();
    if (loc.length != "") responses.locs.push(loc);
  });

  let manyLocs = responses.locs.length !== 1;
  let defaultLoc = !manyLocs
    ? "./" + responses.locs[0].replace(/ /g, "") + "/"
    : "./images/";

  var questions = [
    {
      name: "maxImages",
      type: "input",
      message: "How many images do you want to download?",
      default: 100,
      validate: function(value) {
        var isValid = !Number.isNaN(value);
        return isValid || "This should be an integer number!";
      }
    },
    {
      name: "location",
      type: "input",
      message: "Enter location to save",
      default: defaultLoc, // './' + responses.locs[0] + '/',
      validate: function(value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter a location";
        }
      }
    },
    {
      message: "Create folders for each Location?",
      type: "confirm",
      name: "useFolders",
      default: manyLocs
    },
    {
      name: "waitInterval",
      type: "input",
      message: "How long should chrome wait between page loads (ms)?",
      default: 1500,
      validate: function(value) {
        var isValid = !Number.isNaN(value);
        return isValid || "This should be an integer number!";
      }
    },
    {
      message: "Display scraping with Chrome?",
      type: "confirm",
      name: "headless",
      default: false
    }
  ];

  inquirer.prompt(questions).then(function() {
    responses = { ...responses, ...arguments[0] }; // responses.location = arguments[0].location
    if (!responses.maxImages) responses.maxImages = 10;
    if (responses.maxImages == 0) responses.maxImages = 100000;
    if (responses.waitInterval < 300) responses.waitInterval = 300;

    responses.length = responses.maxImages * responses.locs.length;
    initDownload();
  });
}

function initDownload() {
  let locs = [];
  responses.locs.forEach(name => {
    let loc = {};
    loc.name = name.replace(/^\s+|\s+$/g, "");
    loc.page =
      "https://www.instagram.com/explore/locations/" +
      loc.name.replace(/ /g, "%20");
    loc.location = responses.location;
    if (responses.useFolders && responses.locs.length > 1)
      loc.location += "/" + loc.name.replace(/ /g, "") + "/";
    if (loc.name !== "") locs.push(loc);
    fs.ensureDirSync(loc.location);
    if (!fs.existsSync(loc.location)) {
      fs.mkdirSync(loc.location);
    }
  });

  status.locs = ora({
    text: "Scraping Location Info",
    spinner: "dots2"
  }).start();

  var browseObj, broswer, page;

  asyncForEach(locs, async (loc, index) => {
    if (!browseObj) {
      browseObj = await startBrowser();
      browser = browseObj.browser;
      page = browseObj.page;
    }
    let images = await getImages(loc, page);

    let outputDirectory = "./" + loc.name + "_media.json";
    writeFile(outputDirectory, images);

    if (index == locs.length - 1) browser.close();
  });
}

async function startBrowser() {
  let height = 1000;
  let width = 1600;
  const browser = await puppeteer.launch({ headless: !responses.headless });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  const {
    targetInfos: [{ targetId }]
  } = await browser._connection.send("Target.getTargets");

  // Tab window.
  const { windowId } = await browser._connection.send(
    "Browser.getWindowForTarget",
    { targetId }
  );

  await browser._connection.send("Browser.setWindowBounds", {
    bounds: { height, width },
    windowId
  });

  if (responses.itemType == "Board") {
    await logIn(page);
  }

  return { browser, page };
}

async function getImages(loc, page) {
  let locUrl = encodeURIComponent(loc.name);

  await page.goto(loc.page);
  await page.waitFor(2000);

  const bodyHandle = await page.$("body");
  const { height } = await bodyHandle.boundingBox();
  await bodyHandle.dispose();

  // Scroll one viewport at a time, pausing to let content load
  const viewportHeight = page.viewport().height;

  let images = [];
  for (i = 1; i <= responses.maxImages; i++) {
    let sel = getImageSel(i);

    // await scrollAndWait(page, i)

    let image = await page.evaluate(
      (i, sel) => {
        let data = {};
        let item = document.querySelector(sel); //('div.GrowthUnauthPin_brioPin')
        data.imgSrc = item ? item.getAttribute("src") : "";
        data.id = item
          ? item.parentNode.parentNode.parentNode
              .getAttribute("href")
              .split("/")[2]
          : "";
        data.index = i;
        console.log(data.id);
        return data;
      },
      i,
      sel
    );

    if (i % 9 == 0) {
      await page.evaluate(_viewportHeight => {
        window.scrollBy(0, _viewportHeight);
      }, viewportHeight);
      await page.waitFor(Number(responses.waitInterval));
    }

    if ((i >= 25 && i <= 27) || (i >= 37 && i <= 48)) {
      counter++;
      continue;
    }
    processImage(image, loc);
    images.push(image);
  }
  return images;
}

async function logIn(page) {
  await page.goto("https://www.pinterest.com/");
  await page.click(
    "body > div:nth-child(3) > div > div > div > div > div:nth-child(4) > div > div:nth-child(2) > button"
  ); // Log in Button
  await page.waitFor(500);
  await page.click("#email");
  await page.waitFor(500);
  await page.keyboard.type("pinterestdownloader@gmail.com");
  await page.waitFor(500);
  await page.click("#password");
  await page.waitFor(500);
  await page.keyboard.type("downloader!");
  await page.waitFor(500);
  await page.click(
    "body > div.App.AppBase.Module > div > div.mainContainer > div > div > div > div > div > div > div:nth-child(2) > form > button"
  );
  await page.waitForNavigation();
}

function processImage(image, loc) {
  if (itemsBeingProcessed > maxItems) {
    fileQueue.push(image);
    return;
  }

  itemsBeingProcessed += 1;
  saveImage(image, loc);
}

function saveImage(image, loc) {
  let link = image.imgSrc;
  let index = image.index;
  let name = index + "-" + image.id;
  let folder = loc.location || "./";

  // name = name.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '').trim()
  // if (name.length > 20) name = name.slice(0,40).replace(/\s/g,'')

  let stream = fs.createWriteStream(folder + name + ".jpg");

  if (link) {
    request(link)
      .on("error", function(err) {
        console.log(err);
      })
      .pipe(stream);
  } else {
    counter++;
    finishImage(loc);
  }
  stream.on("finish", () => {
    counter++;
    finishImage(loc);
    if (counter == responses.length) {
      status.downloading.succeed();
      ora("Complete").succeed();
      t1 = now();
      let secs = ((t1 - t0) / 1000).toFixed(1);
      console.log(
        "Output took " + secs + " seconds ( " + secs / 60 + " minutes)"
      );
    }
  });
}

function finishImage(loc) {
  itemsBeingProcessed -= 1;
  if (!status.downloading) {
    status.locs.succeed();
    status.downloading = ora("Downloading Images...").start();
  }
  status.downloading.text = `Processed ${counter} of ${
    responses.length
  } total | loc: ${loc.name}`; // process.stdout.write(`\rprocessed ${counter} of ${responses.length} total / working on ... ${topic.name} `)
  if (itemsBeingProcessed <= maxItems && fileQueue.length > 0) {
    processImage(fileQueue.shift(), loc);
  }
}

function writeFile(outputName = outputFilename, data, callback) {
  if (typeof data !== "string") {
    data = JSON.stringify(data);
  }

  fs.writeFile(outputName, data, function(err) {
    if (err) {
      console.log("error saving data:");
      console.log(err);
    }

    if (callback) {
      callback(err);
    }
  });
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function getImageSel(num) {
  let row = Math.ceil(num / 3);
  let col = num - (row - 1) * 3;
  if (row > 9) {
    row = 9 + ((row - 1) % 3);
  }
  // console.log(num, row,col)
  return (
    "#react-root > section > main > article > div:nth-child(4) > div > div:nth-child(" +
    row +
    ") > div:nth-child(" +
    col +
    ") > a > div > div.KL4Bh > img"
  );
}

async function scrollAndWait(page, i) {
  try {
    await page.waitForSelector(getPinSel(i + 10), { timeout: 500 });
    return;
    // ...
  } catch (error) {
    if (i > 10) await page.hover(getPinSel(i + 5));
    await page.waitFor(1000);
    scrollAndWait(page, i);
  }
}
