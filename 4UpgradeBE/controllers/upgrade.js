const db = require("../util/dbConnect");
const { throwError } = require("../util/errors");
const {
	typeRoll,
	tierRoll,
	badRollShield,
} = require("../util/projectUtil/rolls");
const { v4: uuidv4 } = require("uuid");
const {
	deleteItem,
	getWeaponStats,
	item_uidToResource,
	removeStat,
} = require("../util/projectUtil/helperFunctions");

exports.postUpgrade = async (req, res, next) => {
	//Verify the user has the item and suficient quantity
	const item_uids = req.body.items;
	const weapon_uid = req.body.id;
	const username = req.username;
	try {
		if (item_uids.length > 2) {
			throwError(400, "Please reload the browser");
		}
	} catch (err) {
		next(err);
	}
	// Retrieves weapon stats, also check's if weapon_uid belongs to user.
	const currentWeaponStats = await getWeaponStats(username, weapon_uid, next);

	const fullItemsPromises = await item_uids.map(async (item_uid) => {
		const response = await item_uidToResource(item_uid);
		return response.rows[0];
	});
	const fullItems = await Promise.all(fullItemsPromises);

	const effectSortResultArray = effectSort(
		fullItems,
		weapon_uid,
		currentWeaponStats.stats,
		username
	);
	if (!effectSortResultArray.effectPossible) {
		return res.status(200).send(effectSortResultArray.message);
	}
	try {
		for (let i = 0; i < item_uids.length; i++) {
			// TODO: Should error be returned out of the for() to be caught?
			// Can't do consume items here, because if a combination is invalid
			// the user loses items and no effect is added.
			// Validity is not checked correctly if items are not consumed.
			// Combination is checked if valid in effectSort.
			await confirmItemValidity(username, item_uids[i]);
			await deleteItem(username, item_uids[i]);
		}
	} catch (err) {
		next(err);
	}
	await effectSortResultArray.executeEffect();
	return res.status(200).send(true);
};

// Roll the stat

// Select the weapon with the username and add the stats, if error
// weapon doesn't belong to the user and an error will be returned.

async function confirmItemValidity(username, item_uid) {
	const itemConfirmationValues = [username, item_uid];
	const itemConfirmationQuery =
		"SELECT username, item_uid, quantity FROM resource_inventory \
		WHERE username = $1 AND item_uid = $2;";
	const userItemResult = await db.query(
		itemConfirmationQuery,
		itemConfirmationValues
	);
	// TEST if returns error with faux request
	if (userItemResult.rowCount < 1) {
		return throwError(400, "Please refresh the page.");
	} else {
		return userItemResult;
	}
}

async function addWeaponStat(stat_uid, username, weapon_uid) {
	db.query(
		"SELECT weapon_uid FROM weapon_inventory \
    WHERE username = $1 AND weapon_uid = $2",
		[username, weapon_uid]
	);
	const weaponStatInsertQuery =
		"INSERT INTO weapon_stats(weapon_stat_uid, weapon_uid, stat_uid) VALUES($1,$2,$3)";
	const weaponStatInsertQueryValues = [uuidv4(), weapon_uid, stat_uid];
	return await db.query(weaponStatInsertQuery, weaponStatInsertQueryValues);
}

// Selects a stat at weighted random from the DB. Calls another func to add the
// stat to the weapon.
async function weaponElixirEffect(weapon_uid, fullItems, username) {
	let rolledValue = tierRoll();
	if (fullItems[1]) {
		rolledValue = badRollShield(rolledValue, fullItems[1].tier);
	}
	const statRetrieveQueryValues = [rolledValue, typeRoll()];
	const statRetrieveQuery =
		"SELECT * FROM stats WHERE tier = $1 AND type = $2";
	const result = await db.query(statRetrieveQuery, statRetrieveQueryValues);
	const stat_uid = result.rows[0].stat_uid;
	await addWeaponStat(stat_uid, username, weapon_uid);
}
// Picks a weapon stat at complete random and removes it.
async function astralStoneEffect(currentWeaponStats, fullItems) {
	let randomNumber = 0;
	if (fullItems[1]) {
		const filteredStats = currentWeaponStats.filter(
			(stat) => stat.tier < fullItems[1].tier
		);
		if (filteredStats.length === 0) {
			randomNumber = Math.ceil(Math.random() * currentWeaponStats.length);
			return removeStat(
				currentWeaponStats[randomNumber - 1].weapon_stat_uid
			);
		}
		randomNumber = Math.ceil(Math.random() * filteredStats.length);
		return await removeStat(
			filteredStats[randomNumber - 1].weapon_stat_uid
		);
	}
	randomNumber = Math.ceil(Math.random() * currentWeaponStats.length);
	return await removeStat(
		currentWeaponStats[randomNumber - 1].weapon_stat_uid
	);
}
// Checks if the first item sent is defined in combinations and returns
// an object which contains values if effect is possible,
// a message and the effect's function.
function effectSort(fullItems, weapon_uid, currentWeaponStats, username) {
	switch (fullItems[0].item_uid) {
		case "a5b5bff3-1ec1-4a94-b998-5394772158ba":
			if (currentWeaponStats.length > 5) {
				return {
					effectPossible: false,
					message: "Weapon stats are full",
				};
			}
			return {
				effectPossible: true,
				message: "Weapon upgraded",
				executeEffect: () =>
					weaponElixirEffect(weapon_uid, fullItems, username),
			};
		case "3f7d57cd-27b2-4759-9b57-bf56f30ce9d0":
			if (currentWeaponStats.length === 0) {
				return {
					effectPossible: false,
					message: "No stats to delete",
				};
			}
			return {
				effectPossible: true,
				message: "Weapon upgraded",
				executeEffect: () =>
					astralStoneEffect(currentWeaponStats, fullItems),
			};
		default:
			return {
				effectPossible: false,
				message: "No such combination",
			};
	}
}
