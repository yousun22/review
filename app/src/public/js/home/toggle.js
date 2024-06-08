var toggle = document.getElementById('container');
var toggleContainer = document.getElementById('toggle-container');
var toggleNumber;

toggle.addEventListener('click', function() {
	toggleNumber = !toggleNumber;
	if (toggleNumber) {
		toggleContainer.style.clipPath = 'inset(0 0 0 50%)';
		toggleContainer.style.backgroundColor = '#D74046';
	} else {
		toggleContainer.style.clipPath = 'inset(0 50% 0 0)';
		toggleContainer.style.backgroundColor = 'dodgerblue';
	}
	console.log(toggleNumber)
});